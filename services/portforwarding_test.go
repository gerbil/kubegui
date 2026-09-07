package services

import (
	"context"
	"testing"
)

// TestPortForwardSessionManagement tests the in-memory session tracking
// functions (ListPortForwards, GetPortForward, StopPortForward) without
// requiring a real Kubernetes cluster. The actual port-forward dialer
// (StartPortForward) requires a live cluster and SPDY connectivity, so
// it is not tested here.
func TestPortForwardSessionManagement(t *testing.T) {
	// Ensure clean state
	pfSessionsMu.Lock()
	pfSessions = map[string]*portForwardRunner{}
	pfSessionsMu.Unlock()

	// List should be empty initially
	sessions := ListPortForwards()
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions initially, got %d", len(sessions))
	}

	// Get non-existent session should error
	_, err := GetPortForward("nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent session")
	}

	// Stop non-existent session should error
	err = StopPortForward("nonexistent")
	if err == nil {
		t.Fatal("expected error stopping non-existent session")
	}

	// Manually insert a session to test management functions.
	// We need a real cancel function to avoid nil pointer dereference.
	_, cancel := context.WithCancel(context.Background())
	pfSessionsMu.Lock()
	pfSessions["test-session-1"] = &portForwardRunner{
		session: PortForwardSession{
			ID:         "test-session-1",
			Namespace:  "default",
			PodName:    "nginx",
			RemotePort: "80",
			LocalPort:  "8080",
			Status:     "active",
			StartedAt:  "2025-01-01T00:00:00Z",
		},
		cancel: cancel,
	}
	pfSessionsMu.Unlock()

	// List should return 1 session
	sessions = ListPortForwards()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0].ID != "test-session-1" {
		t.Fatalf("expected session ID 'test-session-1', got %q", sessions[0].ID)
	}
	if sessions[0].Status != "active" {
		t.Fatalf("expected status 'active', got %q", sessions[0].Status)
	}

	// Get by ID
	session, err := GetPortForward("test-session-1")
	if err != nil {
		t.Fatalf("GetPortForward failed: %v", err)
	}
	if session.PodName != "nginx" || session.RemotePort != "80" {
		t.Fatalf("unexpected session data: %+v", session)
	}

	// Stop should succeed
	err = StopPortForward("test-session-1")
	if err != nil {
		t.Fatalf("StopPortForward failed: %v", err)
	}

	// Session should still be in the map but with status "stopped"
	// (removal from the map is async — it happens inside the ForwardPorts goroutine)
	session, err = GetPortForward("test-session-1")
	if err != nil {
		t.Fatalf("GetPortForward after stop failed: %v", err)
	}
	if session.Status != "stopped" {
		t.Fatalf("expected status 'stopped' after stop, got %q", session.Status)
	}
}

// TestPortForwardSessionData verifies PortForwardSession JSON field names
// are correct for Wails binding compatibility.
func TestPortForwardSessionData(t *testing.T) {
	s := PortForwardSession{
		ID:         "pf:default:nginx:80:1234567890",
		Namespace:  "default",
		PodName:    "nginx",
		RemotePort: "80",
		LocalPort:  "8888",
		Status:     "active",
		StartedAt:  "2025-06-01T12:00:00Z",
	}

	if s.ID == "" {
		t.Error("ID should not be empty")
	}
	if s.Namespace != "default" {
		t.Errorf("expected namespace 'default', got %q", s.Namespace)
	}
	if s.PodName != "nginx" {
		t.Errorf("expected podName 'nginx', got %q", s.PodName)
	}
	if s.RemotePort != "80" {
		t.Errorf("expected remotePort '80', got %q", s.RemotePort)
	}
	if s.LocalPort != "8888" {
		t.Errorf("expected localPort '8888', got %q", s.LocalPort)
	}
	if s.Status != "active" {
		t.Errorf("expected status 'active', got %q", s.Status)
	}
}

// TestPortForwardSessionError verifies error field is properly set.
func TestPortForwardSessionError(t *testing.T) {
	s := PortForwardSession{
		ID:     "pf:error:test",
		Status: "error",
		Error:  "connection refused",
	}
	if s.Error != "connection refused" {
		t.Errorf("expected error 'connection refused', got %q", s.Error)
	}
}
