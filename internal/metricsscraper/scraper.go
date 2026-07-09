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
	"fmt"
	"kubegui/internal/db"
	"kubegui/internal/logger"
	"time"

	"github.com/matryer/runner"
	"k8s.io/client-go/kubernetes"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"

	_ "modernc.org/sqlite"

	"kubegui/internal/kubeclients"

	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	_ "k8s.io/client-go/tools/clientcmd"
	"k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

type NodeMetrics struct {
	Cpu    float64
	Memory float64
	Disk   float64
	Time   string
}

type PodMetrics struct {
	Cpu    int
	Memory float64
	Time   string
}

var (
	metricsScraperTask *runner.Task
	metricDuration     = 60 * time.Minute
	metricResolution   = 1 * time.Minute
)

func Scrape() {
	// stop the previous task if it's running
	if metricsScraperTask != nil && metricsScraperTask.Running() {
		logger.Logger.Warn("metrics scraping task is running; trying to stop - " + metricsScraperTask.ID + "\n")
		metricsScraperTask.Stop()
		// sleep a bit
		// time.Sleep(5 * time.Second)
	}

	metricsScraperTask = runner.Go(func(shouldStop runner.S) error {
		logger.Logger.Info("starting Metrics Scraper", "version", "0.0.1")

		// Create the metrics client
		metricsclient, err := kubeclients.GetMetricsClient()
		if err != nil {
			logger.Logger.Error("unable to generate a metricsclient — scraper abort: %s", err.Error())
			return err
		}

		// Create the clientset client
		clientset, err := kubeclients.GetClientset()
		if err != nil {
			logger.Logger.Error("unable to generate a clientset — scraper abort: %s", err.Error())
			return err
		}

		// Populate tables
		err = CreateDatabase()
		if err != nil {
			logger.Logger.Error("unable to initialize database tables: %s", err.Error())
		}

		// Immediate first scrape so data lands in MDB right away (no 1-min wait).
		if err = update(metricsclient, clientset, metricDuration, nil); err != nil {
			logger.Logger.Warn("initial metrics scrape failed", "err", err)
		}

		// Start the machine. Scrape every metricResolution
		ticker := time.NewTicker(metricResolution)

		logger.Logger.Info("Starting Metrics Scraper - new ticker", ticker)

		for {
			select {
			case <-ticker.C:
				err = update(metricsclient, clientset, metricDuration, nil)
				if err != nil {
					logger.Logger.Warn("metrics scrape tick failed", "err", err)
				}
			}

			if shouldStop() {
				ticker.Stop()
				logger.Logger.Warn("---- Stopping scraper\n")
				break
			}
		}

		return nil
	})
}

/**
* Update the Node and Pod metrics in the provided DB
 */
func update(metricsclient *metricsclient.Clientset, clientset *kubernetes.Clientset, metricDuration time.Duration, metricNamespaces []string) error {
	nodeMetrics := &v1beta1.NodeMetricsList{}
	podMetrics := &v1beta1.PodMetricsList{}

	// If no namespace filter is provided, collect node metrics from metrics-server.
	// metricNamespaces is nil when called from Scrape(), or [""] when called for
	// a cluster-wide scrape — both mean "all nodes".
	if metricNamespaces == nil || (len(metricNamespaces) == 1 && metricNamespaces[0] == "") {
		nodeCtx, nodeCancel := context.WithTimeout(context.Background(), 10*time.Second)
		nm, err := metricsclient.MetricsV1beta1().NodeMetricses().List(nodeCtx, v1.ListOptions{})
		nodeCancel()
		if err != nil {
			// metrics-server may not be installed on this cluster; treat as non-fatal
			// and continue — the scraper will still persist disk / pod data.
			logger.Logger.Warn("metrics-server node metrics unavailable (skipping)", "err", err)
		} else {
			nodeMetrics = nm
		}
	}

	// List pod metrics across the cluster, or for a given namespace.
	// When metricNamespaces is nil (cluster-wide scrape), fetch from all namespaces
	// by passing "" to PodMetricses, which returns pods across every namespace.
	podNamespaces := metricNamespaces
	if podNamespaces == nil {
		podNamespaces = []string{""}
	}
	for _, namespace := range podNamespaces {
		podCtx, podCancel := context.WithTimeout(context.Background(), 10*time.Second)
		pod, err := metricsclient.MetricsV1beta1().PodMetricses(namespace).List(podCtx, v1.ListOptions{})
		podCancel()
		if err != nil {
			logger.Logger.Warn("metrics-server pod metrics unavailable (skipping)", "namespace", namespace, "err", err)
			continue
		}
		podMetrics.TypeMeta = pod.TypeMeta
		podMetrics.ListMeta = pod.ListMeta
		podMetrics.Items = append(podMetrics.Items, pod.Items...)
	}

	nodeDiskMetricsAvailable := CheckNodeDiskMetricsAvailable(clientset)
	nodeCpuUsagePercent, nodeRamUsagePercent, nodeStoragePercent, _, _, err := GetNodesMetrics(nodeDiskMetricsAvailable, clientset, metricsclient)
	if err != nil {
		// Non-fatal: log and continue so the DB is still culled.
		logger.Logger.Warn("GetNodesMetrics failed (skipping DB update)", "err", err)
		// Still cull old rows even if we have no new data.
		if cullErr := CullDatabase(metricDuration); cullErr != nil {
			logger.Logger.Error("Error culling database: %s", cullErr)
		}
		return nil
	}

	// Insert scrapes into DB
	if err = UpdateDatabase(nodeMetrics, podMetrics, nodeCpuUsagePercent, nodeRamUsagePercent, nodeStoragePercent); err != nil {
		logger.Logger.Error("Error updating database: %s", err)
		return err
	}

	// Delete rows outside of the metricDuration time
	if err = CullDatabase(metricDuration); err != nil {
		logger.Logger.Error("Error culling database: %s", err)
		return err
	}

	return nil
}

/*
CreateDatabase creates tables for node and pod metrics
*/
func CreateDatabase() error {
	sqlStmt := `
	CREATE TABLE IF NOT EXISTS nodes (uid TEXT, name TEXT, cpu TEXT, memory TEXT, storage TEXT, cpupercent TEXT, memorypercent TEXT, storagepercent TEXT, time DATETIME);
	CREATE TABLE IF NOT EXISTS pods (uid TEXT, name TEXT, namespace TEXT, container TEXT, cpu TEXT, memory TEXT, storage TEXT, cpupercent TEXT, memorypercent TEXT, storagepercent TEXT, time DATETIME);
	`
	_, err := db.MDB.Exec(sqlStmt)
	if err != nil {
		return err
	}

	return nil
}

/*
UpdateDatabase updates nodeMetrics and podMetrics with scraped data
*/
func UpdateDatabase(nodeMetrics *v1beta1.NodeMetricsList, podMetrics *v1beta1.PodMetricsList, nodeCPUPercent, nodeMemoryPercent, NodeStoragePercent map[string]float64) error {
	tx, err := db.MDB.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare("insert into nodes(uid, name, cpu, memory, storage, cpupercent, memorypercent, storagepercent, time) values(?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))")
	if err != nil {
		return err
	}
	defer stmt.Close()

	// Build a name-keyed lookup so we can attach raw values when available.
	nodeMetricsMap := make(map[string]*v1beta1.NodeMetrics, len(nodeMetrics.Items))
	for i := range nodeMetrics.Items {
		nodeMetricsMap[nodeMetrics.Items[i].Name] = &nodeMetrics.Items[i]
	}

	// Write one row per node using the computed percentage maps as the authoritative
	// source of node names. This ensures rows are always written even when the
	// metrics-server is unavailable and nodeMetrics.Items is empty.
	for name, cpuPct := range nodeCPUPercent {
		uid := name // fallback UID when metrics-server is absent
		var cpuRaw, memRaw, storRaw int64
		if nm, ok := nodeMetricsMap[name]; ok {
			uid = string(nm.UID)
			cpuRaw = nm.Usage.Cpu().MilliValue()
			memRaw = nm.Usage.Memory().MilliValue() / 1000
			storRaw = nm.Usage.Storage().MilliValue() / 1000
		}
		_, err = stmt.Exec(uid, name, cpuRaw, memRaw, storRaw, cpuPct, nodeMemoryPercent[name], NodeStoragePercent[name])
		if err != nil {
			return err
		}
	}

	stmt, err = tx.Prepare("insert into pods(uid, name, namespace, container, cpu, memory, storage, time) values(?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, v := range podMetrics.Items {
		for _, u := range v.Containers {
			_, err = stmt.Exec(v.UID, v.Name, v.Namespace, u.Name, u.Usage.Cpu().MilliValue(), u.Usage.Memory().MilliValue()/1000, u.Usage.StorageEphemeral().MilliValue()/1000)
			if err != nil {
				return err
			}
		}
	}

	err = tx.Commit()

	if err != nil {
		rberr := tx.Rollback()
		if rberr != nil {
			return rberr
		}
		return err
	}

	return nil
}

/*
CullDatabase deletes rows from nodes and pods based on a time window.
*/
func CullDatabase(window time.Duration) error {
	tx, err := db.MDB.Begin()
	if err != nil {
		return err
	}

	windowStr := fmt.Sprintf("-%.0f seconds", window.Seconds())

	nodestmt, err := tx.Prepare("delete from nodes where time <= datetime('now', 'localtime', ?);")
	if err != nil {
		return err
	}

	defer nodestmt.Close()
	_, err = nodestmt.Exec(windowStr)
	if err != nil {
		return err
	}

	//affected, _ := res.RowsAffected()
	//wails.Logger.Error("Cleaning up nodes: %d rows removed\n", affected)

	podstmt, err := tx.Prepare("delete from pods where time <= datetime('now', 'localtime', ?);")
	if err != nil {
		return err
	}

	defer podstmt.Close()
	_, err = podstmt.Exec(windowStr)
	if err != nil {
		return err
	}

	//affected, _ = res.RowsAffected()
	//wails.Logger.Error("Cleaning up pods: %d rows removed\n", affected)
	err = tx.Commit()

	if err != nil {
		rberr := tx.Rollback()
		if rberr != nil {
			return rberr
		}
		return err
	}

	return nil
}

/*
GetNodesMetricsDatabase get nodeMetrics data
*/
func GetNodesMetricsDatabase(name string) []NodeMetrics {
	// Ensure tables exist (idempotent - safe to call before scraper has started)
	if err := CreateDatabase(); err != nil {
		logger.Logger.Error(err.Error())
		return nil
	}

	// Query the database to get all todos
	rows, err := db.MDB.Query(`
		SELECT cpupercent, memorypercent, storagepercent, time
		FROM (
			SELECT cpupercent, memorypercent, storagepercent, time
			FROM nodes
			WHERE name = ?
			ORDER BY time DESC
			LIMIT 10
		)
		ORDER BY time ASC
	`, name)
	if err != nil {
		logger.Logger.Error(err.Error()) // Log an error and stop the program if the query fails
		return nil
	}
	defer rows.Close() // Ensure rows are closed after processing

	var nodeMetrics []NodeMetrics // Slice to store configs
	for rows.Next() {
		var nodeMetric NodeMetrics
		if err := rows.Scan(&nodeMetric.Cpu, &nodeMetric.Memory, &nodeMetric.Disk, &nodeMetric.Time); err != nil {
			logger.Logger.Error(err.Error()) // Log an error and stop the program if the query fails
			return nil
		}
		nodeMetrics = append(nodeMetrics, nodeMetric)
	}

	return nodeMetrics
}

/*
GetPopMetricsDatabase get podMetrics data
*/
func GetPodMetricsDatabase(name, ns string) []PodMetrics {
	// Ensure tables exist (idempotent - safe to call before scraper has started)
	if err := CreateDatabase(); err != nil {
		logger.Logger.Error(err.Error())
		return nil
	}

	// Query the database to get all todos
	rows, err := db.MDB.Query("SELECT cpu, memory, time FROM pods WHERE name = ? AND namespace = ? GROUP BY time ORDER BY time DESC LIMIT 10", name, ns)
	if err != nil {
		logger.Logger.Error(err.Error()) // Log an error and stop the program if the query fails
		return nil
	}
	defer rows.Close() // Ensure rows are closed after processing

	var podMetrics []PodMetrics // Slice to store configs
	for rows.Next() {
		var podMetric PodMetrics
		if err := rows.Scan(&podMetric.Cpu, &podMetric.Memory, &podMetric.Time); err != nil {
			logger.Logger.Error(err.Error()) // Log an error and stop the program if the query fails
			return nil
		}
		podMetrics = append(podMetrics, podMetric)
	}

	return podMetrics
}
