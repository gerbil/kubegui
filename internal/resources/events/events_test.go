package events

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestFormatClusterEventMessage(t *testing.T) {
	t.Run("Reason only includes object", func(t *testing.T) {
		ev := corev1.Event{
			Reason: "SuccessfulDelete",
			InvolvedObject: corev1.ObjectReference{
				Kind: "Pod",
				Name: "my-app",
			},
		}
		got := formatClusterEventMessage(ev)
		want := "SuccessfulDelete Pod/my-app"
		if got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
	})

	t.Run("Message with reason prefixes when missing", func(t *testing.T) {
		ev := corev1.Event{
			Reason:  "SuccessfulDelete",
			Message: "pod removed successfully",
		}
		got := formatClusterEventMessage(ev)
		want := "SuccessfulDelete: pod removed successfully"
		if got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
	})

	t.Run("Falls back to object only if no message or reason", func(t *testing.T) {
		ev := corev1.Event{
			InvolvedObject: corev1.ObjectReference{
				Kind: "Node",
				Name: "node-1",
			},
		}
		got := formatClusterEventMessage(ev)
		want := "Node/node-1"
		if got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
	})
}
