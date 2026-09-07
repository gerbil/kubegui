package services

import (
  "context"
  "encoding/base64"
  "fmt"
  "io"
  idb "kubegui/internal/db"
  "os"
  "sync"
  "time"

  "github.com/wailsapp/wails/v3/pkg/application"
  corev1 "k8s.io/api/core/v1"
  metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
  "k8s.io/client-go/kubernetes"
  "k8s.io/client-go/kubernetes/scheme"
  "k8s.io/client-go/rest"
  "k8s.io/client-go/tools/clientcmd"
  "k8s.io/client-go/tools/remotecommand"
)

var (
  nodeShellSessionsMu sync.RWMutex
  nodeShellSessions   = map[string]*nodeShellSession{}

  podShellSessionsMu sync.RWMutex
  podShellSessions   = map[string]*podShellSession{}
)

type podShellSession struct {
  id          string
  namespace   string
  podName     string
  container   string
  stdinWriter *io.PipeWriter
  resize      chan remotecommand.TerminalSize
  cancel      context.CancelFunc
  cleanupOnce sync.Once
}

func emitPodShellOutput(sessionID string, data []byte) {
  if len(data) == 0 {
    return
  }
  application.Get().Event.Emit("podShellOutput", map[string]any{
    "sessionId": sessionID,
    "data":      base64.StdEncoding.EncodeToString(data),
    "enc":       "b64",
  })
}

func emitPodShellStatus(sessionID, status, message string) {
  payload := map[string]any{
    "sessionId": sessionID,
    "status":    status,
  }
  if message != "" {
    payload["message"] = message
  }
  application.Get().Event.Emit("podShellStatus", payload)
}

func startPodShellSession(namespace, podName, containerName string) (*podShellSession, error) {
  cs, restConfig, err := activeClientAndConfig()
  if err != nil {
    return nil, err
  }
  ctx, cancel := context.WithCancel(context.Background())
  stdinReader, stdinWriter := io.Pipe()
  stdoutReader, stdoutWriter := io.Pipe()
  request := cs.CoreV1().RESTClient().Post().Resource("pods").Namespace(namespace).Name(podName).SubResource("exec").VersionedParams(&corev1.PodExecOptions{
    Container: containerName,
    Command:   []string{"sh", "-c", "export TERM=xterm-256color; clear; (bash || ash || sh)"},
    Stdout:    true,
    Stdin:     true,
    Stderr:    true,
    TTY:       true,
  }, scheme.ParameterCodec)
  exec, err := remotecommand.NewSPDYExecutor(restConfig, "POST", request.URL())
  if err != nil {
    cancel()
    _ = stdinReader.Close()
    _ = stdinWriter.Close()
    _ = stdoutReader.Close()
    _ = stdoutWriter.Close()
    return nil, err
  }
  sessionID := fmt.Sprintf("pod-shell:%s:%s:%s:%d", namespace, podName, containerName, time.Now().UnixNano())
  session := &podShellSession{
    id:          sessionID,
    namespace:   namespace,
    podName:     podName,
    container:   containerName,
    stdinWriter: stdinWriter,
    resize:      make(chan remotecommand.TerminalSize, 16),
    cancel:      cancel,
  }
  podShellSessionsMu.Lock()
  podShellSessions[sessionID] = session
  podShellSessionsMu.Unlock()
  cleanup := func() {
    session.cleanupOnce.Do(func() {
      podShellSessionsMu.Lock()
      delete(podShellSessions, sessionID)
      podShellSessionsMu.Unlock()
      _ = stdinWriter.Close()
      _ = stdinReader.Close()
      _ = stdoutWriter.Close()
      _ = stdoutReader.Close()
      close(session.resize)
    })
  }
  go func() {
    defer cleanup()
    buf := make([]byte, 4096)
    for {
      n, readErr := stdoutReader.Read(buf)
      if n > 0 {
        emitPodShellOutput(sessionID, buf[:n])
      }
      if readErr != nil {
        return
      }
    }
  }()
  go func() {
    err := exec.StreamWithContext(ctx, remotecommand.StreamOptions{
      Stdin:             stdinReader,
      Stdout:            stdoutWriter,
      Stderr:            stdoutWriter,
      Tty:               true,
      TerminalSizeQueue: podShellResizeQueue{ch: session.resize},
    })
    if err != nil {
      emitPodShellStatus(sessionID, "error", err.Error())
    } else {
      emitPodShellStatus(sessionID, "closed", "")
    }
    cleanup()
  }()
  emitPodShellStatus(sessionID, "ready", "")
  return session, nil
}

func getPodShellSession(sessionID string) *podShellSession {
  podShellSessionsMu.RLock()
  defer podShellSessionsMu.RUnlock()
  return podShellSessions[sessionID]
}

type podShellResizeQueue struct {
  ch <-chan remotecommand.TerminalSize
}

func (q podShellResizeQueue) Next() *remotecommand.TerminalSize {
  size, ok := <-q.ch
  if !ok {
    return nil
  }
  return &size
}

func activeClientAndConfig() (*kubernetes.Clientset, *rest.Config, error) {
  clusterConfig, err := idb.GetActiveClusterconfig()
  if err != nil {
    return nil, nil, err
  }
  rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: clusterConfig.ConfigPath}
  overrides := &clientcmd.ConfigOverrides{CurrentContext: clusterConfig.Context}
  cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides)
  restConfig, err := cc.ClientConfig()
  if err != nil {
    return nil, nil, err
  }
  cs, err := kubernetes.NewForConfig(restConfig)
  if err != nil {
    return nil, nil, err
  }
  return cs, restConfig, nil
}
func findHostToolsPod(ctx context.Context, cs *kubernetes.Clientset, nodeName string) (*corev1.Pod, error) {
  pods, err := cs.CoreV1().Pods("kube-system").List(ctx, metav1.ListOptions{
    LabelSelector: "app=host-tools",
    FieldSelector: "spec.nodeName=" + nodeName,
    Limit:         1,
  })
  if err != nil {
    return nil, fmt.Errorf("list pods on node %s: %w", nodeName, err)
  }
  if len(pods.Items) == 0 {
    return nil, fmt.Errorf("no host-tools pods found on node %s", nodeName)
  }
  pod := pods.Items[0]
  return &pod, nil
}
func emitNodeShellOutput(sessionID string, data []byte) {
  if len(data) == 0 {
    return
  }
  // Base64-encode so binary/non-UTF8 bytes survive JSON serialisation intact.
  application.Get().Event.Emit("nodeShellOutput", map[string]any{
    "sessionId": sessionID,
    "data":      base64.StdEncoding.EncodeToString(data),
    "enc":       "b64",
  })
}
func emitNodeShellStatus(sessionID, status, message string) {
  payload := map[string]any{
    "sessionId": sessionID,
    "status":    status,
  }
  if message != "" {
    payload["message"] = message
  }
  application.Get().Event.Emit("nodeShellStatus", payload)
}
func startNodeShellSession(nodeName string) (*nodeShellSession, error) {
  cs, restConfig, err := activeClientAndConfig()
  if err != nil {
    return nil, err
  }
  ctx, cancel := context.WithCancel(context.Background())
  pod, err := findHostToolsPod(ctx, cs, nodeName)
  if err != nil {
    cancel()
    return nil, err
  }
  if len(pod.Spec.Containers) == 0 {
    cancel()
    return nil, fmt.Errorf("pod %s/%s has no containers", pod.Namespace, pod.Name)
  }
  containerName := pod.Spec.Containers[0].Name
  stdinReader, stdinWriter := io.Pipe()
  stdoutReader, stdoutWriter := io.Pipe()
  request := cs.CoreV1().RESTClient().Post().Resource("pods").Namespace(pod.Namespace).Name(pod.Name).SubResource("exec").VersionedParams(&corev1.PodExecOptions{
    Container: containerName,
    Command:   []string{"sh", "-c", "export TERM=xterm-256color; clear; (bash || ash || sh)"},
    Stdout:    true,
    Stdin:     true,
    Stderr:    true,
    TTY:       true,
  }, scheme.ParameterCodec)
  exec, err := remotecommand.NewSPDYExecutor(restConfig, "POST", request.URL())
  if err != nil {
    cancel()
    _ = stdinReader.Close()
    _ = stdinWriter.Close()
    _ = stdoutReader.Close()
    _ = stdoutWriter.Close()
    return nil, err
  }
  sessionID := fmt.Sprintf("node-shell:%s:%d", nodeName, time.Now().UnixNano())
  session := &nodeShellSession{
    id:          sessionID,
    nodeName:    nodeName,
    stdinWriter: stdinWriter,
    resize:      make(chan remotecommand.TerminalSize, 16),
    cancel:      cancel,
  }
  nodeShellSessionsMu.Lock()
  nodeShellSessions[sessionID] = session
  nodeShellSessionsMu.Unlock()
  cleanup := func() {
    session.cleanupOnce.Do(func() {
      nodeShellSessionsMu.Lock()
      delete(nodeShellSessions, sessionID)
      nodeShellSessionsMu.Unlock()
      _ = stdinWriter.Close()
      _ = stdinReader.Close()
      _ = stdoutWriter.Close()
      _ = stdoutReader.Close()
      close(session.resize)
    })
  }
  go func() {
    defer cleanup()
    buf := make([]byte, 4096)
    for {
      n, readErr := stdoutReader.Read(buf)
      if n > 0 {
        emitNodeShellOutput(sessionID, buf[:n])
      }
      if readErr != nil {
        return
      }
    }
  }()
  go func() {
    err := exec.StreamWithContext(ctx, remotecommand.StreamOptions{
      Stdin:             stdinReader,
      Stdout:            stdoutWriter,
      Stderr:            stdoutWriter,
      Tty:               true,
      TerminalSizeQueue: nodeShellResizeQueue{ch: session.resize},
    })
    if err != nil {
      emitNodeShellStatus(sessionID, "error", err.Error())
    } else {
      emitNodeShellStatus(sessionID, "closed", "")
    }
    cleanup()
  }()
  emitNodeShellStatus(sessionID, "ready", "")
  return session, nil
}
func getNodeShellSession(sessionID string) *nodeShellSession {
  nodeShellSessionsMu.RLock()
  defer nodeShellSessionsMu.RUnlock()
  return nodeShellSessions[sessionID]
}
func copyFile(src, dst string) error {
  in, err := os.Open(src)
  if err != nil {
    return err
  }
  defer func() { _ = in.Close() }()
  out, err := os.Create(dst)
  if err != nil {
    return err
  }
  defer func() { _ = out.Close() }()
  _, err = io.Copy(out, in)
  return err
}
func trimUnderscore(ns string) string {
  if ns == "_" {
    return ""
  }
  return ns
}
