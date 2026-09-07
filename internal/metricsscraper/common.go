// Copyright 2017 The Kubernetes Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package metricsscraper

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"kubegui/internal/logger"
	"math"
	"os"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/metrics/pkg/apis/metrics/v1beta1"
	"k8s.io/metrics/pkg/client/clientset/versioned"
)

// summary models the /stats/summary JSON
type Summary struct {
	Node struct {
		NodeName string `json:"nodeName"`
		Fs       struct {
			CapacityBytes  *uint64 `json:"capacityBytes,omitempty"`
			UsedBytes      *uint64 `json:"usedBytes,omitempty"`
			AvailableBytes *uint64 `json:"availableBytes,omitempty"`
		} `json:"fs"`
		Runtime struct {
			ImageFs struct {
				CapacityBytes  *uint64 `json:"capacityBytes,omitempty"`
				UsedBytes      *uint64 `json:"usedBytes,omitempty"`
				AvailableBytes *uint64 `json:"availableBytes,omitempty"`
			} `json:"imageFs"`
		} `json:"runtime"`
	} `json:"node"`
}

// GetEnv - Lookup the environment variable provided and set to default value if variable isn't found
func GetEnv(key, fallback string) string {
	if value := os.Getenv(key); len(value) > 0 {
		return value
	}

	return fallback
}

// GetResourceFromPath extracts the resource from the URL path /api/v1/<action>.
// Ignores potential subresources.
func GetResourceFromPath(path string) *string {
	if !strings.HasPrefix(path, "/api/v1") {
		return nil
	}

	parts := strings.Split(path, "/")
	if len(parts) < 3 {
		return nil
	}

	return &parts[3]
}

func RandomBytes(size int) []byte {
	bytes := make([]byte, size)
	_, _ = rand.Read(bytes)

	return bytes
}

func Random64BaseEncodedBytes(size int) string {
	bytes := RandomBytes(size)
	return base64.StdEncoding.EncodeToString(bytes)
}

func CheckNodeMetricsAvailable(mc *versioned.Clientset) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := mc.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err != nil {
		logger.Logger.Error("Node metrics not available:", err)
		return err
	}
	return nil
}

func CheckNodeDiskMetricsAvailable(client *kubernetes.Clientset) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	nodes, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil || len(nodes.Items) == 0 {
		return false
	}
	req := client.CoreV1().RESTClient().Get().Resource("nodes").Name(nodes.Items[0].Name).SubResource("proxy").Suffix("stats/summary")
	_, err = req.DoRaw(ctx)
	if err != nil {
		return false
	}
	return true
}

func CheckPodMetricsAvailable(mc *versioned.Clientset, namespace string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := mc.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		logger.Logger.Error("Pod metrics not available:", err)
		return err
	}
	return nil
}

// GetNodeDiskUsagePercent fetches % disk usage for a given node using kubelet summary API
func GetNodeDiskUsagePercent(ctx context.Context, client *kubernetes.Clientset, nodeName string) (float64, error) {
	//fmt.Println("Fetching node disk usage for node:", nodeName)
	req := client.CoreV1().RESTClient().Get().Resource("nodes").Name(nodeName).SubResource("proxy").Suffix("stats/summary")

	raw, err := req.DoRaw(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to query summary API: %w", err)
	}

	var s Summary
	if err := json.Unmarshal(raw, &s); err != nil {
		return 0, fmt.Errorf("failed to unmarshal summary: %w", err)
	}

	//fmt.Println("Node:", s.Node.NodeName)
	//fmt.Println(*s.Node.Fs.AvailableBytes, *s.Node.Fs.CapacityBytes, *s.Node.Fs.UsedBytes)

	if s.Node.Fs.CapacityBytes == nil || s.Node.Fs.UsedBytes == nil || *s.Node.Fs.CapacityBytes == 0 {
		return 0, fmt.Errorf("invalid filesystem stats for node %s", nodeName)
	}

	percent := (float64(*s.Node.Fs.UsedBytes) / float64(*s.Node.Fs.CapacityBytes)) * 100
	return math.Round(percent*100) / 100, nil
}

func GetNodesMetrics(nodeDiskMetricsAvailable bool, cs *kubernetes.Clientset, mc *versioned.Clientset) (nodeCpuUsagePercent, nodeRamUsagePercent, nodeStoragePercent map[string]float64, nodePodsCount, nodePodsCapacity map[string]int, err error) {
	nodeCpuUsagePercent = make(map[string]float64)
	nodeRamUsagePercent = make(map[string]float64)
	nodeStoragePercent = make(map[string]float64)
	nodePodsCount = make(map[string]int)
	nodePodsCapacity = make(map[string]int)

	// Nodes list — bounded context so a slow API server can't stall the scraper.
	nodesCtx, nodesCancel := context.WithTimeout(context.Background(), 25*time.Second)
	// Informers usage
	nodes, err := cs.CoreV1().Nodes().List(nodesCtx, metav1.ListOptions{})
	nodesCancel()
	if err != nil {
		return
	}

	metricsCtx, metricsCancel := context.WithTimeout(context.Background(), 15*time.Second)
	nodesMetrics, metricsErr := mc.MetricsV1beta1().NodeMetricses().List(metricsCtx, metav1.ListOptions{})
	metricsCancel()
	if metricsErr != nil {
		// metrics-server may not be installed; continue with zero CPU/RAM but still
		// populate disk usage and node list so the DB always gets a row per node.
		logger.Logger.Warn("metrics-server unavailable in GetNodesMetrics (CPU/RAM will be 0)", "err", metricsErr)
		nodesMetrics = &v1beta1.NodeMetricsList{}
	}

	// Build a lookup map so we can match by name rather than relying on identical ordering.
	nodeMetricsByName := make(map[string]*v1beta1.NodeMetrics, len(nodesMetrics.Items))
	for i := range nodesMetrics.Items {
		nodeMetricsByName[nodesMetrics.Items[i].Name] = &nodesMetrics.Items[i]
	}

	for _, node := range nodes.Items {
		// CPU usage
		nodeCpuUsagePercent[node.Name] = 0
		capacityCPU := float64(node.Status.Capacity.Cpu().MilliValue())
		if nm, ok := nodeMetricsByName[node.Name]; ok && nm.Usage != nil {
			usageCPU := float64(nm.Usage.Cpu().MilliValue())
			if usageCPU != 0 && capacityCPU != 0 {
				cpuPercent := (usageCPU / capacityCPU) * 100
				if cpuPercent < 0 {
					cpuPercent = 0
				} else if cpuPercent > 100 {
					cpuPercent = 100
				}
				nodeCpuUsagePercent[node.Name] = cpuPercent
			}
		}

		// MEM usage
		nodeRamUsagePercent[node.Name] = 0
		capacityRAM := float64(node.Status.Capacity.Memory().MilliValue())
		if nm, ok := nodeMetricsByName[node.Name]; ok && nm.Usage != nil {
			usageRAM := float64(nm.Usage.Memory().MilliValue())
			if capacityRAM != 0 {
				ramPercent := (usageRAM / capacityRAM) * 100
				if ramPercent < 0 {
					ramPercent = 0
				} else if ramPercent > 100 {
					ramPercent = 100
				}
				nodeRamUsagePercent[node.Name] = ramPercent
			}
		}

		// Pods capacity — use a bounded context so a slow cluster can't block the scraper loop.
		podsCtx, podsCancel := context.WithTimeout(context.Background(), 5*time.Second)
		p, _ := cs.CoreV1().Pods("").List(podsCtx, metav1.ListOptions{FieldSelector: "spec.nodeName=" + node.Name})
		podsCancel()
		nodePodsCount[node.Name] = len(p.Items)
		nodePodsCapacity[node.Name] = int(node.Status.Capacity.Pods().Value())

		// DISK usage
		if nodeDiskMetricsAvailable {
			diskCtx, diskCancel := context.WithTimeout(context.Background(), 10*time.Second)
			pct, _ := GetNodeDiskUsagePercent(diskCtx, cs, node.Name)
			diskCancel()
			nodeStoragePercent[node.Name] = pct
		} else {
			nodeStoragePercent[node.Name] = 0
		}
	}

	return
}
