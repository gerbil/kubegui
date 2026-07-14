package services

import (
	"context"
	"fmt"
	"io"
	"kubegui/internal/logger"
	"net/http"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)
// PortForwardSession holds the state for a single port-forward tunnel.
type PortForwardSession struct {
	ID         string `json:"id"`
	Namespace  string `json:"namespace"`
	PodName    string `json:"podName"`
	RemotePort string `json:"remotePort"`
	LocalPort  string `json:"localPort"`
	Status     string `json:"status"` // "active", "stopped", "error"
	StartedAt  string `json:"startedAt"`
	Error      string `json:"error,omitempty"`
}
var (
	pfSessionsMu sync.RWMutex
	pfSessions   = map[string]*portForwardRunner{}
)
type portForwardRunner struct {
	session  PortForwardSession
	cancel   context.CancelFunc
	stopOnce sync.Once
}
// StartPortForward creates a new port-forward tunnel to a pod.
// localPort can be "0" to let the OS pick a free port.
func StartPortForward(namespace, podName, remotePort, localPort string) (PortForwardSession, error) {
	cs, restConfig, err := activeClientAndConfig()
	if err != nil {
		return PortForwardSession{}, fmt.Errorf("get kube client: %w", err)
	}
	// Resolve the pod to ensure it exists
	_, err = cs.CoreV1().Pods(namespace).Get(context.TODO(), podName, metav1.GetOptions{})
	if err != nil {
		return PortForwardSession{}, fmt.Errorf("pod %s/%s not found: %w", namespace, podName, err)
	}
	sessionID := fmt.Sprintf("pf:%s:%s:%s:%d", namespace, podName, remotePort, time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	// Build the URL for the pod port-forward subresource
	req := cs.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("portforward")
	transport, upgrader, err := spdy.RoundTripperFor(restConfig)
	if err != nil {
		cancel()
		return PortForwardSession{}, fmt.Errorf("create spdy transport: %w", err)
	}
	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, "POST", req.URL())
	// Prepare ports
	ports := []string{fmt.Sprintf("%s:%s", localPort, remotePort)}
	// readyChan is closed by ForwardPorts once the tunnel is up.
	// stopChan being closed causes ForwardPorts to return.
	readyChan := make(chan struct{}, 1)
	stopChan := make(chan struct{}, 1)
	pf, err := portforward.New(dialer, ports, stopChan, readyChan, io.Discard, io.Discard)
	if err != nil {
		cancel()
		return PortForwardSession{}, fmt.Errorf("create portforward: %w", err)
	}
	runner := &portForwardRunner{
		session: PortForwardSession{
			ID:         sessionID,
			Namespace:  namespace,
			PodName:    podName,
			RemotePort: remotePort,
			LocalPort:  localPort,
			Status:     "starting",
			StartedAt:  time.Now().UTC().Format(time.RFC3339),
		},
		cancel: cancel,
	}
	pfSessionsMu.Lock()
	pfSessions[sessionID] = runner
	pfSessionsMu.Unlock()
	// errChan lets ForwardPorts propagate an early error to the main select
	// so callers see the real error immediately instead of a 30-second timeout.
	errChan := make(chan error, 1)
	// stopOnce ensures stopChan is closed exactly once.
	var stopOnce sync.Once
	closeStop := func() { stopOnce.Do(func() { close(stopChan) }) }
	// Bridge context cancellation → stopChan so ForwardPorts exits cleanly.
	go func() {
		<-ctx.Done()
		closeStop()
	}()
	// ForwardPorts MUST start immediately — it is the function that closes
	// readyChan to signal the tunnel is up.  Waiting on readyChan before
	// calling ForwardPorts causes a deadlock → 30-second timeout.
	go func() {
		defer func() {
			closeStop() // always close stopChan when ForwardPorts exits
			pfSessionsMu.Lock()
			delete(pfSessions, sessionID)
			pfSessionsMu.Unlock()
		}()
		if fwErr := pf.ForwardPorts(); fwErr != nil {
			errChan <- fwErr
			if runner.session.Status != "stopped" {
				logger.Logger.Error("port-forward failed", "sessionID", sessionID, "error", fwErr)
				runner.session.Status = "error"
				runner.session.Error = fwErr.Error()
			}
		} else if runner.session.Status != "error" && runner.session.Status != "stopped" {
			runner.session.Status = "stopped"
		}
	}()
	// Wait for the tunnel to become ready, an early error, a cancel, or timeout.
	select {
	case <-readyChan:
		if assignedPorts, gErr := pf.GetPorts(); gErr == nil && len(assignedPorts) > 0 {
			runner.session.LocalPort = fmt.Sprintf("%d", assignedPorts[0].Local)
		}
		runner.session.Status = "active"
		logger.Logger.Info("port-forward started",
			"sessionID", sessionID,
			"namespace", namespace,
			"pod", podName,
			"localPort", runner.session.LocalPort,
			"remotePort", remotePort,
		)
	case fwErr := <-errChan:
		cancel()
		runner.session.Status = "error"
		runner.session.Error = fwErr.Error()
		return runner.session, fmt.Errorf("port-forward failed: %w", fwErr)
	case <-ctx.Done():
		runner.session.Status = "error"
		runner.session.Error = "context cancelled"
		return runner.session, fmt.Errorf("port-forward cancelled")
	case <-time.After(30 * time.Second):
		cancel()
		runner.session.Status = "error"
		runner.session.Error = "timeout waiting for port-forward to become ready"
	}
	return runner.session, nil
}
// StopPortForward stops an active port-forward session.
func StopPortForward(sessionID string) error {
	pfSessionsMu.RLock()
	runner, ok := pfSessions[sessionID]
	pfSessionsMu.RUnlock()
	if !ok {
		return fmt.Errorf("port-forward session %s not found", sessionID)
	}
	runner.stopOnce.Do(func() {
		runner.cancel()
		runner.session.Status = "stopped"
	})
	return nil
}
// ListPortForwards returns all active port-forward sessions.
func ListPortForwards() []PortForwardSession {
	pfSessionsMu.RLock()
	defer pfSessionsMu.RUnlock()
	sessions := make([]PortForwardSession, 0, len(pfSessions))
	for _, runner := range pfSessions {
		sessions = append(sessions, runner.session)
	}
	return sessions
}
// GetPortForward returns a specific port-forward session by ID.
func GetPortForward(sessionID string) (PortForwardSession, error) {
	pfSessionsMu.RLock()
	defer pfSessionsMu.RUnlock()
	runner, ok := pfSessions[sessionID]
	if !ok {
		return PortForwardSession{}, fmt.Errorf("port-forward session %s not found", sessionID)
	}
	return runner.session, nil
}
