package events

import (
	"context"
	"sort"
	"strings"
	"time"

	"kubegui/internal/kubeclients"
	"kubegui/internal/resources/informers"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// LogRow represents a single structured cluster system log entry.
type LogRow struct {
	Timestamp string `json:"timestamp"`
	Component string `json:"component"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}

// EventItem is the serialisable form of a k8s event sent to the frontend.
type EventItem = map[string]any

// eventsFromCache retrieves corev1.Event objects from the global informer cache.
//
// Three outcomes:
//   - (events, true)  — cache hit, use the returned slice (may be empty if no events)
//   - (nil, false)    — informer manager not started at all; caller may try the live API
//   - ([], true)      — manager started but cache not yet synced; caller should return
//     empty gracefully rather than hammering the live API with a call that
//     will time out on a slow remote cluster
func eventsFromCache(namespace string) ([]corev1.Event, bool) {
	gm := informers.GetGlobalManager()
	if gm == nil {
		// Informers not started — caller can fall back to live API.
		return nil, false
	}
	items, err := gm.ListFromCache("events", namespace)
	if err != nil {
		// Manager started but cache still warming up. Return an empty slice so
		// the caller surfaces "no events yet" instead of triggering a live API
		// call that would time out on a slow/remote cluster.
		return []corev1.Event{}, true
	}
	out := make([]corev1.Event, 0, len(items))
	for _, item := range items {
		var ev corev1.Event
		if convErr := runtime.DefaultUnstructuredConverter.FromUnstructured(item, &ev); convErr != nil {
			continue
		}
		out = append(out, ev)
	}
	return out, true
}

// GetClusterLogs fetches kube-system events and returns them as structured log rows.
func GetClusterLogs(limit int) ([]LogRow, error) {
	if limit <= 0 {
		limit = 30
	}

	// Prefer the informer cache to avoid a live API round-trip on slow clusters.
	if cached, ok := eventsFromCache("kube-system"); ok {
		return buildClusterLogRows(cached, limit), nil
	}

	cs, err := kubeclients.GetClientset()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := cs.CoreV1().Events("kube-system").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return buildClusterLogRows(out.Items, limit), nil
}

// GetNamespaceEvents returns events for a namespace sorted newest-first.
func GetNamespaceEvents(namespace string, limit int) ([]EventItem, error) {
	if limit <= 0 {
		limit = 30
	}

	// Prefer the informer cache to avoid a live API round-trip on slow clusters.
	if cached, ok := eventsFromCache(namespace); ok {
		items := mapEvents(cached, nil)
		sort.SliceStable(items, func(i, j int) bool {
			return eventTimeString(items[i]) > eventTimeString(items[j])
		})
		if len(items) > limit {
			items = items[:limit]
		}
		return items, nil
	}

	cs, err := kubeclients.GetClientset()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := cs.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := mapEvents(out.Items, nil)
	sort.SliceStable(items, func(i, j int) bool {
		return eventTimeString(items[i]) > eventTimeString(items[j])
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

// GetResourceEvents returns events for a namespace, optionally filtered to a single pod.
func GetResourceEvents(namespace, podName string) ([]EventItem, error) {
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := cs.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	return mapEvents(out.Items, func(ev corev1.Event) bool {
		if podName == "" {
			return true
		}
		return strings.EqualFold(ev.InvolvedObject.Kind, "Pod") && ev.InvolvedObject.Name == podName
	}), nil
}

// GetDeploymentEvents returns namespace-scoped events for a deployment.
func GetDeploymentEvents(namespace, deploymentName string, limit int) ([]EventItem, error) {
	return getInvolvedObjectEvents(namespace, "Deployment", deploymentName, limit)
}

// GetNodeEvents returns cluster-wide events for a node.
func GetNodeEvents(nodeName string, limit int) ([]EventItem, error) {
	return getInvolvedObjectEvents(metav1.NamespaceAll, "Node", nodeName, limit)
}

// GetInvolvedObjectEventsPublic returns events for any resource type by kind, namespace, and name.
// If no events match the exact kind+name filter (e.g. operator doesn't emit events directly on the
// CRD resource), it falls back to a name-only search so that events emitted for child resources
// (e.g. a Deployment managed by a CRD operator) are also surfaced.
func GetInvolvedObjectEventsPublic(namespace, kind, name string, limit int) ([]EventItem, error) {
	items, err := getInvolvedObjectEvents(namespace, kind, name, limit)
	if err != nil {
		return nil, err
	}
	if len(items) > 0 || kind == "" {
		return items, nil
	}
	// No direct events — fall back to name-only so child resource events are visible.
	return getInvolvedObjectEvents(namespace, "", name, limit)
}

// --- internal helpers ---

func buildClusterLogRows(items []corev1.Event, limit int) []LogRow {
	sort.SliceStable(items, func(i, j int) bool {
		return eventTime(items[i]).After(eventTime(items[j]))
	})
	rows := make([]LogRow, 0, limit)
	for _, ev := range items {
		component, ok := inferSystemComponent(ev)
		if !ok {
			continue
		}
		message := formatClusterEventMessage(ev)
		rows = append(rows, LogRow{
			Timestamp: eventTime(ev).UTC().Format(time.RFC3339),
			Component: component,
			Level:     levelFromType(ev.Type),
			Message:   message,
		})
		if len(rows) >= limit {
			break
		}
	}
	return rows
}

func formatClusterEventMessage(ev corev1.Event) string {
	message := strings.TrimSpace(ev.Message)
	reason := strings.TrimSpace(ev.Reason)
	objectName := formatInvolvedObject(ev.InvolvedObject)

	if message != "" {
		if reason != "" && !strings.Contains(strings.ToLower(message), strings.ToLower(reason)) {
			message = reason + ": " + message
		}
		return message
	}

	if reason != "" {
		if objectName != "" {
			return reason + " " + objectName
		}
		return reason
	}

	if objectName != "" {
		return objectName
	}

	message = strings.TrimSpace(strings.Join([]string{
		ev.Source.Component,
		ev.ReportingController,
		ev.InvolvedObject.Kind,
		ev.InvolvedObject.Name,
	}, " "))
	if message == "" {
		message = "cluster event"
	}
	return message
}

func formatInvolvedObject(obj corev1.ObjectReference) string {
	kind := strings.TrimSpace(obj.Kind)
	name := strings.TrimSpace(obj.Name)
	if kind == "" && name == "" {
		return ""
	}
	if kind == "" {
		return name
	}
	if name == "" {
		return kind
	}
	return kind + "/" + name
}

func levelFromType(t string) string {
	switch t {
	case "Warning":
		return "WARN"
	case "Error":
		return "ERROR"
	default:
		return "INFO"
	}
}

func inferSystemComponent(ev corev1.Event) (string, bool) {
	keywords := map[string]string{
		"kubelet":                 "kubelet",
		"kube-controller-manager": "controller-manager",
		"controller-manager":      "controller-manager",
		"kube-scheduler":          "scheduler",
		"scheduler":               "scheduler",
		"kube-apiserver":          "api-server",
		"apiserver":               "api-server",
		"api-server":              "api-server",
		"etcd":                    "etcd",
	}
	candidates := []string{
		strings.ToLower(ev.ReportingController),
		strings.ToLower(ev.ReportingInstance),
		strings.ToLower(ev.Source.Component),
		strings.ToLower(ev.Source.Host),
		strings.ToLower(ev.InvolvedObject.Kind),
		strings.ToLower(ev.InvolvedObject.Name),
		strings.ToLower(ev.Reason),
		strings.ToLower(ev.Message),
	}
	for _, c := range candidates {
		for key, comp := range keywords {
			if c != "" && strings.Contains(c, key) {
				return comp, true
			}
		}
	}
	if ev.Type == "Warning" || ev.Type == "Error" {
		return "cluster", true
	}
	return "", false
}

func eventTime(ev corev1.Event) time.Time {
	if !ev.LastTimestamp.IsZero() {
		return ev.LastTimestamp.Time
	}
	if !ev.FirstTimestamp.IsZero() {
		return ev.FirstTimestamp.Time
	}
	return ev.CreationTimestamp.Time
}

func mapEvents(items []corev1.Event, include func(corev1.Event) bool) []EventItem {
	mapped := make([]EventItem, 0, len(items))
	for _, ev := range items {
		if include != nil && !include(ev) {
			continue
		}
		message := strings.TrimSpace(ev.Message)
		t := eventTime(ev)
		mapped = append(mapped, EventItem{
			"metadata":       map[string]any{"creationTimestamp": t.UTC().Format(time.RFC3339)},
			"lastTimestamp":  t.UTC().Format(time.RFC3339),
			"firstTimestamp": ev.FirstTimestamp.UTC().Format(time.RFC3339),
			"count":          ev.Count,
			"type":           ev.Type,
			"reason":         ev.Reason,
			"message":        message,
			"note":           message,
			"source": map[string]any{
				"component": ev.Source.Component,
				"host":      ev.Source.Host,
			},
			"regarding": map[string]any{
				"kind":      ev.InvolvedObject.Kind,
				"name":      ev.InvolvedObject.Name,
				"namespace": ev.InvolvedObject.Namespace,
			},
			"involvedObject": map[string]any{
				"kind":      ev.InvolvedObject.Kind,
				"name":      ev.InvolvedObject.Name,
				"namespace": ev.InvolvedObject.Namespace,
			},
		})
	}
	sort.SliceStable(mapped, func(i, j int) bool {
		return eventTimeString(mapped[i]) > eventTimeString(mapped[j])
	})
	return mapped
}

func eventTimeString(item EventItem) string {
	if ts, ok := item["lastTimestamp"].(string); ok && ts != "" {
		return ts
	}
	meta, _ := item["metadata"].(map[string]any)
	ts, _ := meta["creationTimestamp"].(string)
	return ts
}

func getInvolvedObjectEvents(namespace, kind, name string, limit int) ([]EventItem, error) {
	if limit <= 0 {
		limit = 30
	}

	filter := func(ev corev1.Event) bool {
		// kind="" means "any kind" — used for name-only fallback
		if kind != "" && !strings.EqualFold(ev.InvolvedObject.Kind, kind) {
			return false
		}
		if name == "" {
			return true
		}
		return ev.InvolvedObject.Name == name
	}

	// Prefer the informer cache to avoid a live API round-trip.
	// eventsFromCache returns (nil, false) only when the manager isn't started at all —
	// in that case we must fall through to the live API.
	// It returns ([], true) when the cache exists but has no matching events (or is warming up),
	// which we treat as a live-API trigger so fresh events are not missed.
	if cached, ok := eventsFromCache(namespace); ok && len(cached) > 0 {
		items := mapEvents(cached, filter)
		if len(items) > limit {
			items = items[:limit]
		}
		return items, nil
	}

	cs, err := kubeclients.GetClientset()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	out, err := cs.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := mapEvents(out.Items, filter)
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}
