package nodes

import (
	"context"
	"fmt"
	"kubegui/internal/metricsscraper"
	"sort"
	"time"

	"kubegui/internal/kubeclients"
	"kubegui/internal/logger"
	"kubegui/internal/resources/informers"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
)

// NodeAllocation represents detailed allocation information for a node.
type NodeAllocation struct {
	Name              string          `json:"name"`
	Status            string          `json:"status"`
	Unschedulable     bool            `json:"unschedulable"`
	CPUCapacity       int64           `json:"cpuCapacity"`       // in millicores
	CPUAllocatable    int64           `json:"cpuAllocatable"`    // in millicores
	CPUUsed           int64           `json:"cpuUsed"`           // in millicores (capacity - allocatable)
	CPUPercent        int             `json:"cpuPercent"`        // percentage utilization
	MemoryCapacity    int64           `json:"memoryCapacity"`    // in bytes
	MemoryAllocatable int64           `json:"memoryAllocatable"` // in bytes
	MemoryUsed        int64           `json:"memoryUsed"`        // in bytes (capacity - allocatable)
	MemoryPercent     int             `json:"memoryPercent"`     // percentage utilization
	PodsCount         int             `json:"podsCount"`         // currently running pods on node
	PodCapacity       int             `json:"podCapacity"`       // maximum pods allowed on node
	PodAllocated      int             `json:"podAllocated"`      // percentage of pod slots used
	PodAllocations    []PodAllocation `json:"podAllocations,omitempty"`
}

// PodAllocation is compact pod metadata for node workload tile rendering.
type PodAllocation struct {
	UID       string `json:"uid"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Category  string `json:"category"`
	Health    string `json:"health"`
}

// Cordon marks a node as unschedulable.
func Cordon(name string) (map[string]any, error) {
	return setUnschedulable(name, true)
}

// Uncordon marks a node as schedulable.
func Uncordon(name string) (map[string]any, error) {
	return setUnschedulable(name, false)
}

// SetupShellAccess ensures debug tooling is deployed so node shell can be opened.
func SetupShellAccess(nodeName string) error {
	if nodeName == "" {
		return fmt.Errorf("node name is required")
	}
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return err
	}
	// Short timeout just for the node existence check.
	checkCtx, checkCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer checkCancel()
	if _, err := cs.CoreV1().Nodes().Get(checkCtx, nodeName, metav1.GetOptions{}); err != nil {
		return err
	}
	// Longer context for daemonset deployment + readiness polling (up to ~60 s).
	dsCtx, dsCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer dsCancel()
	return ensureHostToolsDaemonSet(dsCtx, cs)
}

// GetNodesAllocation returns detailed allocation information for all nodes.
func GetNodesAllocation() ([]NodeAllocation, error) {
	gm := informers.GetGlobalManager()

	var nodeList []corev1.Node
	var pods []corev1.Pod

	if gm != nil {
		// Try nodes from cache.
		if items, err := gm.ListFromCache("nodes", ""); err == nil && len(items) > 0 {
			for _, item := range items {
				var node corev1.Node
				if convErr := runtime.DefaultUnstructuredConverter.FromUnstructured(item, &node); convErr == nil {
					nodeList = append(nodeList, node)
				}
			}
		}

		// Pods from cache.
		if items, err := gm.ListFromCache("pods", ""); err == nil {
			for _, item := range items {
				var pod corev1.Pod
				if convErr := runtime.DefaultUnstructuredConverter.FromUnstructured(item, &pod); convErr == nil {
					pods = append(pods, pod)
				}
			}
		}
	}
	logger.Logger.Debug("GetNodesAllocation",
		"nodes", len(nodeList),
		"pods", len(pods),
	)
	rows := buildAllocationRows(nodeList, pods)
	return rows, nil
}

func buildAllocationRows(nodes []corev1.Node, pods []corev1.Pod) []NodeAllocation {
	// Count running pods on each node
	podCounts := make(map[string]int, len(nodes))
	podAllocations := make(map[string][]PodAllocation, len(nodes))
	for _, pod := range pods {
		if pod.Spec.NodeName == "" ||
			pod.Status.Phase == corev1.PodSucceeded ||
			pod.Status.Phase == corev1.PodFailed {
			continue
		}
		podCounts[pod.Spec.NodeName]++
		podAllocations[pod.Spec.NodeName] = append(podAllocations[pod.Spec.NodeName], PodAllocation{
			UID:       string(pod.UID),
			Name:      pod.Name,
			Namespace: pod.Namespace,
			Category:  classifyPodCategory(pod),
			Health:    classifyPodHealth(pod),
		})
	}

	rows := make([]NodeAllocation, 0, len(nodes))
	for _, node := range nodes {
		cpuCapacity := node.Status.Capacity.Cpu().MilliValue()
		cpuAllocatable := node.Status.Allocatable.Cpu().MilliValue()
		memCapacity := node.Status.Capacity.Memory().Value()
		memAllocatable := node.Status.Allocatable.Memory().Value()

		status := "Unknown"
		for _, cond := range node.Status.Conditions {
			if cond.Type == corev1.NodeReady {
				if cond.Status == corev1.ConditionTrue {
					status = "Ready"
				} else {
					status = "NotReady"
				}
				break
			}
		}

		podCap := int(node.Status.Capacity.Pods().Value())
		podsUsed := podCounts[node.Name]

		rows = append(rows, NodeAllocation{
			Name:              node.Name,
			Status:            status,
			Unschedulable:     node.Spec.Unschedulable,
			CPUCapacity:       cpuCapacity,
			CPUAllocatable:    cpuAllocatable,
			CPUUsed:           cpuCapacity - cpuAllocatable,
			CPUPercent:        calculatePercent(cpuCapacity, cpuAllocatable),
			MemoryCapacity:    memCapacity,
			MemoryAllocatable: memAllocatable,
			MemoryUsed:        memCapacity - memAllocatable,
			MemoryPercent:     calculatePercent(memCapacity, memAllocatable),
			PodsCount:         podsUsed,
			PodCapacity:       podCap,
			PodAllocated:      calculatePercent(int64(podCap), int64(podCap-podsUsed)),
			PodAllocations:    podAllocations[node.Name],
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })
	return rows
}

func classifyPodCategory(pod corev1.Pod) string {
	if pod.Namespace == "kube-system" {
		return "system"
	}
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == "DaemonSet" {
			return "daemonset"
		}
	}
	return "workload"
}

func classifyPodHealth(pod corev1.Pod) string {
	if pod.DeletionTimestamp != nil {
		return "warning"
	}

	switch pod.Status.Phase {
	case corev1.PodPending:
		return "warning"
	case corev1.PodFailed:
		return "failed"
	}

	for _, status := range pod.Status.InitContainerStatuses {
		if h := classifyContainerStatus(status); h != "healthy" {
			return h
		}
	}
	for _, status := range pod.Status.ContainerStatuses {
		if h := classifyContainerStatus(status); h != "healthy" {
			return h
		}
	}

	if pod.Status.Phase != corev1.PodRunning {
		return "warning"
	}
	return "healthy"
}

func classifyContainerStatus(status corev1.ContainerStatus) string {
	if status.State.Terminated != nil {
		if status.State.Terminated.ExitCode != 0 {
			return "failed"
		}
		return "healthy"
	}
	if status.State.Waiting != nil {
		reason := status.State.Waiting.Reason
		switch reason {
		case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "RunContainerError":
			return "failed"
		default:
			return "healthy"
		}
	}
	if !status.Ready {
		return "warning"
	}
	return "healthy"
}

func calculatePercent(capacity, allocatable int64) int {
	if capacity <= 0 {
		return 0
	}
	used := capacity - allocatable
	if used < 0 {
		used = 0
	}
	v := int((used * 100) / capacity)
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func ensureHostToolsDaemonSet(ctx context.Context, cs *kubernetes.Clientset) error {
	const (
		namespace = "kube-system"
		name      = "host-tools"
		image     = "busybox:1.36"
	)
	labels := map[string]string{"app": "host-tools"}

	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels:    labels,
		},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					Tolerations: []corev1.Toleration{{Operator: corev1.TolerationOpExists}},
					HostPID:     true,
					HostNetwork: true,
					Containers: []corev1.Container{{
						Name:    "host-tools",
						Image:   image,
						Command: []string{"sh", "-c", "sleep 365d"},
						SecurityContext: &corev1.SecurityContext{
							Privileged: boolPtr(true),
						},
						VolumeMounts: []corev1.VolumeMount{{Name: "host-root", MountPath: "/host", ReadOnly: false}},
					}},
					Volumes: []corev1.Volume{{
						Name: "host-root",
						VolumeSource: corev1.VolumeSource{
							HostPath: &corev1.HostPathVolumeSource{Path: "/"},
						},
					}},
				},
			},
		},
	}

	if _, err := cs.AppsV1().DaemonSets(namespace).Create(ctx, ds, metav1.CreateOptions{}); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return err
		}
	}

	deadline := time.Now().Add(55 * time.Second)
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		current, err := cs.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return err
		}
		status := current.Status
		ready := status.DesiredNumberScheduled > 0 &&
			status.NumberReady == status.DesiredNumberScheduled &&
			status.NumberAvailable == status.DesiredNumberScheduled
		if ready {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("host-tools daemonset not ready in time")
		}
		time.Sleep(2 * time.Second)
	}
}

func boolPtr(v bool) *bool { return &v }

func setUnschedulable(name string, unschedulable bool) (map[string]any, error) {
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	node, err := cs.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	node.Spec.Unschedulable = unschedulable
	updated, err := cs.CoreV1().Nodes().Update(ctx, node, metav1.UpdateOptions{})
	if err != nil {
		return nil, err
	}
	out, err := runtime.DefaultUnstructuredConverter.ToUnstructured(updated)
	if err != nil {
		return nil, err
	}
	return out, nil
}

type NodeTaint struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Effect string `json:"effect"`
}

type NodeCondition struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

// CachedNodeAllocation is a lightweight allocation snapshot from the informer cache.
type CachedNodeAllocation struct {
	Name           string                `json:"name"`
	PodsCount      int                   `json:"podsCount"`
	PodAllocations []CachedPodAllocation `json:"podAllocations"`
}

// CachedPodAllocation is compact pod metadata from the informer cache.
type CachedPodAllocation struct {
	UID       string `json:"uid"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Category  string `json:"category"`
	Health    string `json:"health"`
}

type NodeMetricRow struct {
	Name   string  `json:"name"`
	CPU    float64 `json:"cpu"`
	RAM    float64 `json:"ram"`
	Disk   float64 `json:"disk"`
	Pods   int     `json:"pods"`
	PodCap int     `json:"podCap"`
}

func GetMetrics() (nodeMetricRow []NodeMetricRow, err error) {
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	nodeCpuUsagePercent := make(map[string]float64)
	nodeMemoryUsagePercent := make(map[string]float64)
	nodeDiskUsagePercent := make(map[string]float64)
	nodePodsCount := make(map[string]int)
	nodePodsCapacity := make(map[string]int)

	// Nodes list
	out, err := cs.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return
	}

	// All pods for pods inside single node capacity
	podsAll, _ := cs.CoreV1().Pods("").List(ctx, metav1.ListOptions{})

	rows := make([]NodeMetricRow, 0, len(out.Items))

	for _, node := range out.Items {
		// Defaults
		nodeCpuUsagePercent[node.Name] = 0
		nodeMemoryUsagePercent[node.Name] = 0
		nodeDiskUsagePercent[node.Name] = 0
		nodePodsCount[node.Name] = 0
		nodePodsCapacity[node.Name] = 0

		// DB metrics by node name
		nodesMetrics := metricsscraper.GetNodesMetricsDatabase(node.Name)

		// Pods capacity by node name
		for _, pod := range podsAll.Items {
			if pod.Spec.NodeName == node.Name {
				nodePodsCount[node.Name]++
			}
		}
		nodePodsCapacity[node.Name] = int(node.Status.Capacity.Pods().Value())

		// Usage from DB by node name
		for _, metric := range nodesMetrics {
			nodeCpuUsagePercent[node.Name] = metric.Cpu
			nodeMemoryUsagePercent[node.Name] = metric.Memory
			nodeDiskUsagePercent[node.Name] = metric.Disk
		}

		rows = append(rows, NodeMetricRow{
			Name:   node.Name,
			CPU:    nodeCpuUsagePercent[node.Name],
			RAM:    nodeMemoryUsagePercent[node.Name],
			Disk:   nodeDiskUsagePercent[node.Name],
			Pods:   nodePodsCount[node.Name],
			PodCap: nodePodsCapacity[node.Name],
		})
	}

	return
}
