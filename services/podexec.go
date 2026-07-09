package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

var podExecUpgrader = websocket.Upgrader{
	ReadBufferSize:   1024,
	WriteBufferSize:  1024,
	HandshakeTimeout: 15 * time.Second,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// podExecMsg matches the JSON protocol used by xterm-global.js
type podExecMsg struct {
	MsgType string `json:"msg_type"`
	Rows    uint16 `json:"rows"`
	Cols    uint16 `json:"cols"`
	Data    string `json:"data"` // base64-encoded for "input" type
}

// podExecClient adapts a gorilla WebSocket connection into the interfaces
// required by k8s remotecommand: io.Reader (stdin), io.Writer (stdout/stderr),
// and remotecommand.TerminalSizeQueue.
type podExecClient struct {
	ws     *websocket.Conn
	resize chan remotecommand.TerminalSize
}

func (c *podExecClient) Read(p []byte) (int, error) {
	for {
		_, raw, err := c.ws.ReadMessage()
		if err != nil {
			return 0, err
		}
		var msg podExecMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		switch msg.MsgType {
		case "resize":
			select {
			case c.resize <- remotecommand.TerminalSize{Width: msg.Cols, Height: msg.Rows}:
			default:
			}
			// no stdin data — loop again
		case "input":
			decoded, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil || len(decoded) == 0 {
				continue
			}
			n := copy(p, decoded)
			return n, nil
		}
	}
}

func (c *podExecClient) Write(p []byte) (int, error) {
	err := c.ws.WriteMessage(websocket.TextMessage, p)
	return len(p), err
}

func (c *podExecClient) Next() *remotecommand.TerminalSize {
	size, ok := <-c.resize
	if !ok {
		return nil
	}
	return &size
}

// PodExecHandler is the HTTP handler that should be registered for
// GET /resource/exec/{ns}/{name}/{cname}
// It upgrades to WebSocket and streams a shell into the specified pod container.
func PodExecHandler(w http.ResponseWriter, r *http.Request) {
	// Path: /resource/exec/{ns}/{name}/{cname}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/resource/exec/"), "/")
	if len(parts) < 3 {
		http.Error(w, "invalid exec path", http.StatusBadRequest)
		return
	}
	ns, name, cname := parts[0], parts[1], parts[2]

	ws, err := podExecUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	cs, restConfig, err := activeClientAndConfig()
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n[error] failed to get kube client: "+err.Error()))
		return
	}

	req := cs.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(ns).
		Name(name).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: cname,
			Command:   []string{"sh", "-c", "export TERM=xterm-256color; clear; (bash || ash || sh)"},
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(restConfig, "POST", req.URL())
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n[error] executor: "+err.Error()))
		return
	}

	client := &podExecClient{
		ws:     ws,
		resize: make(chan remotecommand.TerminalSize, 8),
	}

	err = exec.StreamWithContext(context.Background(), remotecommand.StreamOptions{
		Stdin:             client,
		Stdout:            client,
		Stderr:            client,
		Tty:               true,
		TerminalSizeQueue: client,
	})
	if err != nil {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n[session ended] "+err.Error()))
	}
}

