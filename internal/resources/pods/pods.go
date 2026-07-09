package pods

import (
	"kubegui/internal/logger"
	"kubegui/internal/resources/informers"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// Stats holds aggregate pod health counters for the active cluster.
type Stats struct {
	Total    int `json:"total"`
	Healthy  int `json:"healthy"`
	Warnings int `json:"warnings"`
	Failed   int `json:"failed"`
}

// GetStats returns aggregate pod health counters across all namespaces.
func GetStats() (s Stats, err error) {
	gm := informers.GetGlobalManager()
	if gm != nil && gm.Status().Started {
		items, err := gm.ListFromCache("pods", "")
		if err == nil {
			for _, item := range items {
				var pod corev1.Pod
				if convErr := runtime.DefaultUnstructuredConverter.FromUnstructured(item, &pod); convErr == nil {
					accumulate(&s, &pod)
				}
			}
			logger.Logger.Debug("GetStats from cache", "total", s.Total)
		}
	}
	return
}

func accumulate(s *Stats, pod *corev1.Pod) {
	if pod == nil || s == nil {
		return
	}
	s.Total++
	phase := pod.Status.Phase
	ready := false
	for _, cond := range pod.Status.Conditions {
		if cond.Type == "Ready" && cond.Status == "True" {
			ready = true
			break
		}
	}
	maxRestarts := 0
	var waitingReasons []string
	all := append([]corev1.ContainerStatus{}, pod.Status.ContainerStatuses...)
	all = append(all, pod.Status.InitContainerStatuses...)
	for _, cs := range all {
		if int(cs.RestartCount) > maxRestarts {
			maxRestarts = int(cs.RestartCount)
		}
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			waitingReasons = append(waitingReasons, cs.State.Waiting.Reason)
		}
	}
	failed := phase == corev1.PodFailed || string(phase) == "Unknown"
	if !failed {
		for _, r := range waitingReasons {
			switch r {
			case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull",
				"CreateContainerConfigError", "CreateContainerError",
				"RunContainerError", "InvalidImageName", "OOMKilled":
				failed = true
			}
		}
	}
	if !failed && maxRestarts >= 5 && len(waitingReasons) > 0 {
		failed = true
	}
	if failed {
		s.Failed++
		return
	}
	if (phase == corev1.PodRunning && ready) || phase == corev1.PodSucceeded {
		s.Healthy++
		return
	}
	s.Warnings++
}
