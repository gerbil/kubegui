package logs

import (
	"context"
	"fmt"
	"html"
	"io"
	"sort"
	"strings"
	"time"

	"kubegui/internal/kubeclients"
	"kubegui/internal/resources/std"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// GetPodLogs returns the last tailLines log lines for a container inside a pod.
func GetPodLogs(namespace, name, container string) ([]string, error) {
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return []string{}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tail := int64(200)
	stream, err := cs.CoreV1().Pods(namespace).GetLogs(name, &corev1.PodLogOptions{
		Container: container,
		TailLines: &tail,
	}).Stream(ctx)
	if err != nil {
		return []string{}, nil
	}
	defer func() { _ = stream.Close() }()
	raw, err := io.ReadAll(stream)
	if err != nil {
		return []string{}, nil
	}
	return formatLogLines(string(raw), name, container), nil
}

// GetDeploymentLogs returns the last log lines across all pods of a deployment.
func GetDeploymentLogs(namespace, deploymentName string) ([]string, error) {
	pods, err := listDeploymentPods(namespace, deploymentName)
	if err != nil || len(pods) == 0 {
		return []string{}, nil
	}
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return []string{}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tail := int64(80)
	var lines []string
	for _, pod := range pods {
		container := ""
		if len(pod.Spec.Containers) > 0 {
			container = pod.Spec.Containers[0].Name
		}
		stream, err := cs.CoreV1().Pods(namespace).GetLogs(pod.Name, &corev1.PodLogOptions{
			Container: container,
			TailLines: &tail,
		}).Stream(ctx)
		if err != nil {
			continue
		}
		raw, err := io.ReadAll(stream)
		_ = stream.Close()
		if err != nil {
			continue
		}
		lines = append(lines, formatLogLines(string(raw), pod.Name, container)...)
	}
	if len(lines) > 300 {
		lines = lines[len(lines)-300:]
	}
	return lines, nil
}

// --- helpers ---

func listDeploymentPods(namespace, deploymentName string) ([]corev1.Pod, error) {
	obj, err := std.GetResource("deployments", namespace, deploymentName)
	if err != nil {
		return nil, err
	}
	selector, found, _ := unstructured.NestedStringMap(obj.Object, "spec", "selector", "matchLabels")
	if !found || len(selector) == 0 {
		return nil, nil
	}
	parts := make([]string, 0, len(selector))
	for k, v := range selector {
		parts = append(parts, fmt.Sprintf("%s=%s", k, v))
	}
	sort.Strings(parts)
	labelSelector := strings.Join(parts, ",")
	cs, err := kubeclients.GetClientset()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	list, err := cs.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelSelector})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func formatLogLines(raw, podName, container string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []string{}
	}
	rawLines := strings.Split(trimmed, "\n")
	result := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		escaped := html.EscapeString(line)
		result = append(result, fmt.Sprintf(
			`<div class="pod-%s"><span class="container-%s">%s</span><span class="log-circle log-normal"></span><span class="code">%s</span></div>`,
			sanitize(podName), sanitize(container), html.EscapeString(container), escaped,
		))
	}
	return result
}

func sanitize(v string) string {
	return strings.NewReplacer("/", "-", ".", "", " ", "-", "_", "-").Replace(strings.ToLower(v))
}