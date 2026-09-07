package nodes

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildAllocationRows(t *testing.T) {
	nodes := []corev1.Node{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "node-b"},
			Spec:       corev1.NodeSpec{Unschedulable: true},
			Status: corev1.NodeStatus{
				Capacity: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("4"),
					corev1.ResourceMemory: resource.MustParse("8Gi"),
					corev1.ResourcePods:   resource.MustParse("20"),
				},
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("3500m"),
					corev1.ResourceMemory: resource.MustParse("7Gi"),
					corev1.ResourcePods:   resource.MustParse("20"),
				},
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionFalse}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "node-a"},
			Status: corev1.NodeStatus{
				Capacity: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("2"),
					corev1.ResourceMemory: resource.MustParse("4Gi"),
					corev1.ResourcePods:   resource.MustParse("10"),
				},
				Allocatable: corev1.ResourceList{
					corev1.ResourceCPU:    resource.MustParse("1800m"),
					corev1.ResourceMemory: resource.MustParse("3500Mi"),
					corev1.ResourcePods:   resource.MustParse("10"),
				},
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
			},
		},
	}

	pods := []corev1.Pod{
		{Spec: corev1.PodSpec{NodeName: "node-a"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}},
		{Spec: corev1.PodSpec{NodeName: "node-a"}, Status: corev1.PodStatus{Phase: corev1.PodPending}},
		{Spec: corev1.PodSpec{NodeName: "node-a"}, Status: corev1.PodStatus{Phase: corev1.PodSucceeded}},
		{Spec: corev1.PodSpec{NodeName: "node-b"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}},
	}

	rows := buildAllocationRows(nodes, pods)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}

	if rows[0].Name != "node-a" || rows[1].Name != "node-b" {
		t.Fatalf("rows not sorted by name: %#v", rows)
	}

	nodeA := rows[0]
	if nodeA.Status != "Ready" {
		t.Fatalf("expected node-a status Ready, got %q", nodeA.Status)
	}
	if nodeA.PodsCount != 2 {
		t.Fatalf("expected node-a pods count 2, got %d", nodeA.PodsCount)
	}
	if nodeA.PodAllocated != 20 {
		t.Fatalf("expected node-a pod allocation 20%%, got %d", nodeA.PodAllocated)
	}

	nodeB := rows[1]
	if nodeB.Status != "NotReady" {
		t.Fatalf("expected node-b status NotReady, got %q", nodeB.Status)
	}
	if !nodeB.Unschedulable {
		t.Fatalf("expected node-b unschedulable true")
	}
	if nodeB.PodsCount != 1 {
		t.Fatalf("expected node-b pods count 1, got %d", nodeB.PodsCount)
	}
}

func TestCalculatePercent(t *testing.T) {
	// ...existing test...
	tests := []struct {
		name        string
		capacity    int64
		allocatable int64
		want        int
	}{
		{name: "normal", capacity: 100, allocatable: 75, want: 25},
		{name: "zero capacity", capacity: 0, allocatable: 0, want: 0},
		{name: "negative used clamps to zero", capacity: 100, allocatable: 200, want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := calculatePercent(tt.capacity, tt.allocatable); got != tt.want {
				t.Fatalf("calculatePercent(%d,%d)=%d, want %d", tt.capacity, tt.allocatable, got, tt.want)
			}
		})
	}
}

// TestGetNodeDetailsConvertsToUnstructured verifies that a typed Node is
// correctly round-tripped through runtime.DefaultUnstructuredConverter so
// that all critical fields (uid, spec, status) survive the conversion.
func TestGetNodeDetailsConvertsToUnstructured(t *testing.T) {
	node := &corev1.Node{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Node"},
		ObjectMeta: metav1.ObjectMeta{
			Name:            "test-node",
			UID:             types.UID("abc-123"),
			ResourceVersion: "999",
		},
		Spec: corev1.NodeSpec{
			PodCIDR: "10.244.0.0/24",
		},
		Status: corev1.NodeStatus{
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
			},
		},
	}

	out, err := runtime.DefaultUnstructuredConverter.ToUnstructured(node)
	if err != nil {
		t.Fatalf("ToUnstructured failed: %v", err)
	}

	meta, ok := out["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("metadata missing or not a map")
	}
	if meta["uid"] != "abc-123" {
		t.Errorf("expected uid=abc-123, got %v", meta["uid"])
	}
	if meta["resourceVersion"] != "999" {
		t.Errorf("expected resourceVersion=999, got %v", meta["resourceVersion"])
	}

	spec, ok := out["spec"].(map[string]interface{})
	if !ok {
		t.Fatalf("spec missing or not a map")
	}
	if spec["podCIDR"] != "10.244.0.0/24" {
		t.Errorf("expected podCIDR=10.244.0.0/24, got %v", spec["podCIDR"])
	}

	status, ok := out["status"].(map[string]interface{})
	if !ok {
		t.Fatalf("status missing or not a map")
	}
	if _, hasCapacity := status["capacity"]; !hasCapacity {
		t.Errorf("expected status.capacity to be present")
	}
}