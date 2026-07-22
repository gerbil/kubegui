package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"kubegui/internal/app"
	"kubegui/internal/cani"
	"kubegui/internal/clusterconfigs"
	"kubegui/internal/clusterruntime"
	idb "kubegui/internal/db"
	"kubegui/internal/kubeclients"
	"kubegui/internal/local"
	"kubegui/internal/logger"
	"kubegui/internal/metricsscraper"
	"kubegui/internal/resources/crd"
	"kubegui/internal/resources/deployments"
	"kubegui/internal/resources/events"
	"kubegui/internal/resources/informers"
	"kubegui/internal/resources/logs"
	"kubegui/internal/resources/networkpolicies"
	"kubegui/internal/resources/nodes"
	"kubegui/internal/resources/pods"
	"kubegui/internal/resources/resourceops"
	"kubegui/internal/resources/std"
	"kubegui/internal/settings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"k8s.io/client-go/tools/remotecommand"
)

type ClusterInfo struct {
	ContextName   string `json:"contextName"`
	Context       string `json:"context"`
	FileName      string `json:"fileName"`
	ServerVersion string `json:"serverVersion"`
	CurrentUser   string `json:"currentUser"`
}

type CRDMenuResponse struct {
	Groups []crd.CategoryGroup `json:"groups"`
	UIMap  map[string]string   `json:"uiMap"`
}

type Backend struct{}

// --- app ---
func (s *Backend) AppServiceStartup() error { return nil }
func (s *Backend) AppGetMyPermissions(ns string) ([]cani.CanIResourceRow, error) {
	flat, err := cani.CollectPermissions(ns)
	if err != nil {
		return nil, err
	}
	return cani.AggregateCanIResults(flat), nil
}
func (s *Backend) AppGetVersion() (string, error)     { return app.ReadConfigFile() }
func (s *Backend) AppGetStats() (app.AppStats, error) { return app.GetAppStats() }
func (s *Backend) AppConfigGetCurrentContextUser() (string, error) {
	return clusterconfigs.GetCurrentContextUser()
}
func (s *Backend) AppConfigGetCurrentClusterVersion() (string, error) {
	return settings.GetCurrentClusterVersion()
}
func (s *Backend) AppConfigGetActiveClusterInfo() (ClusterInfo, error) {
	active, rawCfg, err := clusterconfigs.GetActiveConfigAndRaw()
	if err != nil {
		return ClusterInfo{}, err
	}
	info := ClusterInfo{ContextName: active.ContextName, Context: active.Context, FileName: active.FileName, CurrentUser: active.ContextName}
	if ctx := rawCfg.Contexts[active.Context]; ctx != nil {
		info.CurrentUser = ctx.AuthInfo
	}
	dc, err := kubeclients.GetDiscoveryClient()
	if err == nil {
		type verResult struct {
			ver string
			err error
		}
		ch := make(chan verResult, 1)
		go func() {
			if sv, vErr := dc.ServerVersion(); vErr == nil && sv != nil {
				ch <- verResult{ver: sv.GitVersion}
			} else {
				ch <- verResult{err: vErr}
			}
		}()
		select {
		case r := <-ch:
			if r.err == nil {
				info.ServerVersion = r.ver
			}
		case <-time.After(5 * time.Second):
			// Skip server version if API is unreachable within timeout
		}
	}
	return info, nil
}
func (s *Backend) AppConfigPickClusterIcon(context, filename string) (string, error) {
	path, err := application.Get().Dialog.OpenFile().CanChooseFiles(true).SetTitle("Choose cluster icon").AddFilter("Images", "*.png;*.jpg;*.jpeg;*.svg;*.webp;*.ico").PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", errors.New("no image selected")
	}
	imagesDir := filepath.Join(local.AppDataDir, "images")
	if mkErr := os.MkdirAll(imagesDir, 0o775); mkErr != nil {
		return "", mkErr
	}
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	base = strings.ReplaceAll(base, " ", "_")
	base = strings.ReplaceAll(base, ".", "_")
	base = strings.ReplaceAll(base, ":", "_")
	ext := filepath.Ext(path)
	if ext == "" {
		ext = ".png"
	}
	dest := filepath.Join(imagesDir, base+"_"+time.Now().UTC().Format("20060102_150405_000")+ext)
	if cpErr := copyFile(path, dest); cpErr != nil {
		return "", cpErr
	}
	idb.UpdateImagePath(filename, context, dest)
	application.Get().Event.Emit("clusterConfigsChanged", map[string]any{"source": "icon-change"})
	return dest, nil
}

// --- DB ---
func (s *Backend) DBGetClusterConfigs() ([]idb.Clusterconfig, error) { return idb.GetClusterconfigs() }
func (s *Backend) DBGetClusterConfigByContext(context, fileName string) idb.Clusterconfig {
	return idb.GetClusterconfigByContext(context, fileName)
}
func (s *Backend) DBGetActiveClusterConfig() (idb.Clusterconfig, error) {
	return idb.GetActiveClusterconfig()
}
func (s *Backend) DBAddClusterConfig(fileName, contextName, context, configPath, imagePath string, active int) error {
	idb.AddConfig(fileName, contextName, context, configPath, imagePath, active)
	return nil
}
func (s *Backend) DBUpdateClusterConfig(fileName, contextName, context, configPath, imagePath string, active int) error {
	idb.UpdateConfig(fileName, contextName, context, configPath, imagePath, active)
	return nil
}
func (s *Backend) DBRenameClusterConfig(oldName, newName, context, fileName string) error {
	idb.RenameConfig(oldName, newName, context, fileName)
	return nil
}
func (s *Backend) DBReorderClusterConfigs(configs []string) error {
	items := make([]interface{}, 0, len(configs))
	for _, c := range configs {
		items = append(items, c)
	}
	idb.ReorderConfigs(items)
	return nil
}
func (s *Backend) DBUpdateClusterConfigImagePath(filename, context, newImagePath string) error {
	idb.UpdateImagePath(filename, context, newImagePath)
	return nil
}
func (s *Backend) DBMakeClusterConfigActive(clusterContext, filename string) error {
	idb.ConnectConfig(clusterContext, filename)
	go func() {
		if _, err := clusterruntime.StartForActiveCluster(context.Background()); err != nil {
			logger.Logger.Warn("informer start failed after connect", "err", err)
			application.Get().Event.Emit("informerProgress", map[string]any{
				"stage":   "error",
				"message": err.Error(),
			})
		}
	}()
	return nil
}
func (s *Backend) DBDisconnectClusterConfig() error {
	if err := stopGlobalInformerManager(); err != nil {
		return err
	}
	idb.ResetActiveConfig()
	return nil
}
func (s *Backend) DBDeleteClusterConfig(context, filename string) error {
	idb.DeleteConfig(context, filename)
	return nil
}
func (s *Backend) DBUpdateClusterContext(filename, contextName, contextOld, contextNew string) error {
	idb.UpdateContext(filename, contextName, contextOld, contextNew)
	return nil
}
func (s *Backend) DBGetPodPortForwardingsConfigs() []idb.PodPortforwardingsConfig {
	return idb.GetPodPortforwardingsConfigs()
}
func (s *Backend) DBSavePodPortForwardingsConfig(name, namespace, status, remotePort, localPort string) error {
	_, err := idb.SavePodPortforwardingsConfig(name, namespace, status, remotePort, localPort)
	return err
}
func (s *Backend) DBUpdatePodPortForwardingsConfig(name, namespace, status, remotePort, localPort string) error {
	_, err := idb.UpdatePodPortforwardingsConfig(name, namespace, status, remotePort, localPort)
	return err
}
func (s *Backend) DBDeletePodPortForwardingsConfig(name string) error {
	_, err := idb.DeletePodPortforwardingsConfig(name)
	return err
}
func (s *Backend) DBDeleteAllPodPortForwardingsConfigs() error {
	_, err := idb.DeleteAllPodPortforwardingsConfigs()
	return err
}

// --- menu ---
func (s *Backend) CRDGetMenuList() (CRDMenuResponse, error) {
	if err := enableCRDInformersForActiveCluster(); err != nil {
		return CRDMenuResponse{}, err
	}
	groups, uiMap, err := crd.GetMenuList()
	if err != nil {
		return CRDMenuResponse{}, err
	}
	return CRDMenuResponse{Groups: groups, UIMap: uiMap}, nil
}

// CRDGenerateTemplate fetches the CRD schema for the given group+plural and
// returns a sample YAML manifest generated by crd-to-sample-yaml.
func (s *Backend) CRDGenerateTemplate(group, plural string) (string, error) {
	return crd.GenerateTemplateYAML(group, plural)
}

// --- informers ---
func (s *Backend) InformerStartForActiveCluster() error {
	// Run async — discovery can take up to 90 s on slow/remote clusters.
	// Progress is communicated via informerProgress events so the frontend
	// does not need to block on this call.
	go func() {
		if _, err := startGlobalInformerManagerForActiveCluster(); err != nil {
			logger.Logger.Warn("informer start failed", "err", err)
			application.Get().Event.Emit("informerProgress", map[string]any{
				"stage":   "error",
				"message": err.Error(),
			})
		}
	}()
	return nil
}
func (s *Backend) InformerStop() error      { return stopGlobalInformerManager() }
func (s *Backend) InformerEnableCRD() error { return enableCRDInformersForActiveCluster() }
func (s *Backend) InformerGetHealth() (informers.GlobalStatus, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return informers.GlobalStatus{}, errors.New("global informer manager not started")
	}
	return manager.Status(), nil
}

// InformerGetStatus is a polling-safe variant of InformerGetHealth: it never
// returns an error so Wails does not log "Binding call failed" while the manager
// is still starting up.  Returns an empty (zero-value) status when not ready.
func (s *Backend) InformerGetStatus() (informers.GlobalStatus, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return informers.GlobalStatus{}, nil
	}
	return manager.Status(), nil
}
func (s *Backend) InformerGetTrackedResources() ([]informers.ResourceInfo, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return nil, errors.New("global informer manager not started")
	}
	return manager.GetResources(), nil
}
func (s *Backend) InformerGetCRDDefinitions() ([]informers.CRDDefinition, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return nil, errors.New("global informer manager not started")
	}
	return manager.GetCRDDefinitions(), nil
}
func (s *Backend) InformerSubscribeResource(resource string) error {
	manager := getGlobalInformerManager()
	if manager == nil {
		return errors.New("global informer manager not started")
	}
	return manager.SubscribeResource(resource)
}
func (s *Backend) InformerUnsubscribeResource(resource string) error {
	manager := getGlobalInformerManager()
	if manager == nil {
		return errors.New("global informer manager not started")
	}
	manager.UnsubscribeResource(resource)
	return nil
}
func (s *Backend) InformerGetSubscriptions() ([]string, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return nil, errors.New("global informer manager not started")
	}
	return manager.Subscriptions(), nil
}

// --- logs ---
func (s *Backend) LogsGetPod(namespace, name, container string) ([]string, error) {
	return logs.GetPodLogs(namespace, name, container)
}
func (s *Backend) LogsGetDeployment(namespace, name string) ([]string, error) {
	return logs.GetDeploymentLogs(namespace, name)
}
func (s *Backend) LogsGetCluster(limit int) (any, error) { return events.GetClusterLogs(limit) }

// --- events ---
func (s *Backend) EventsGetNamespace(namespace string, limit int) (any, error) {
	return events.GetNamespaceEvents(namespace, limit)
}
func (s *Backend) EventsGetResource(namespace, pod string) (any, error) {
	return events.GetResourceEvents(namespace, pod)
}
func (s *Backend) EventsGetForResource(namespace, kind, name string, limit int) (any, error) {
	if limit <= 0 {
		limit = 50
	}
	return events.GetInvolvedObjectEventsPublic(namespace, kind, name, limit)
}
func (s *Backend) EventsGetDeployment(namespace, deployment string, limit int) (any, error) {
	return events.GetDeploymentEvents(namespace, deployment, limit)
}
func (s *Backend) EventsGetNode(node string, limit int) (any, error) {
	return events.GetNodeEvents(node, limit)
}

// --- runtime ---
func getGlobalInformerManager() *informers.GlobalInformers {
	return clusterruntime.GetGlobalManager()
}
func startGlobalInformerManagerForActiveCluster() (*informers.GlobalInformers, error) {
	return clusterruntime.StartForActiveCluster(context.Background())
}
func enableCRDInformersForActiveCluster() error {
	return clusterruntime.EnableCRDForActiveCluster(context.Background())
}
func stopGlobalInformerManager() error {
	return clusterruntime.StopForActiveCluster()
}

// --- resource ---
func (s *Backend) ResourceList(resource, namespace string) ([]map[string]any, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return nil, fmt.Errorf("global informer manager not started")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return resourceops.List(ctx, manager, resource, namespace)
}
func (s *Backend) ResourceGetDetails(resource, namespace, name string) (map[string]any, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return nil, fmt.Errorf("global informer manager not started")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return resourceops.Details(ctx, manager, resource, namespace, name)
}
func (s *Backend) ResourceDelete(resource, namespace, name string) error {
	return std.DeleteResource(resource, trimUnderscore(namespace), name)
}
func (s *Backend) ResourceEdit(resource, namespace, name, patchJSON string) (map[string]any, error) {
	manager := getGlobalInformerManager()
	if manager == nil {
		return nil, fmt.Errorf("global informer manager not started")
	}
	var obj map[string]any
	if parseErr := json.Unmarshal([]byte(patchJSON), &obj); parseErr != nil {
		return nil, fmt.Errorf("invalid patch json: %w", parseErr)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return resourceops.Edit(ctx, manager, resource, trimUnderscore(namespace), name, obj)
}
func (s *Backend) ResourceAdd(resource, objectJSON string) (map[string]any, error) {
	var obj map[string]any
	if err := json.Unmarshal([]byte(objectJSON), &obj); err != nil {
		return nil, fmt.Errorf("invalid object json: %w", err)
	}
	created, err := std.CreateResource(resource, obj)
	if err != nil {
		return nil, err
	}
	return created.Object, nil
}
// NetworkPolicyGetGraph returns a react-flow compatible graph for a NetworkPolicy.
func (s *Backend) NetworkPolicyGetGraph(namespace, name string) (networkpolicies.Graph, error) {
	raw, err := std.GetResource("networkpolicies", namespace, name)
	if err != nil {
		return networkpolicies.Graph{}, err
	}
	return networkpolicies.BuildGraph(raw.Object), nil
}

func (s *Backend) DeploymentRestart(namespace, name string) (map[string]any, error) {
	return deployments.Restart(namespace, name)
}
func (s *Backend) DeploymentScale(namespace, name string, replicas int) (map[string]any, error) {
	return deployments.Scale(namespace, name, replicas)
}
func (s *Backend) NodeCordon(name string) (map[string]any, error)   { return nodes.Cordon(name) }
func (s *Backend) NodeUncordon(name string) (map[string]any, error) { return nodes.Uncordon(name) }
func (s *Backend) NodeSetupShell(name string) error                 { return nodes.SetupShellAccess(name) }
func (s *Backend) PodsGetStats() (pods.Stats, error)                { return pods.GetStats() }
func (s *Backend) PodGetStatsEndpoint() (pods.Stats, error)         { return pods.GetStats() }
func (s *Backend) NodesGetMetrics() ([]nodes.NodeMetricRow, error) {
	return nodes.GetMetrics()
}
func (s *Backend) NodeGetMetrics() ([]nodes.NodeMetricRow, error) {
	return nodes.GetMetrics()
}
func (s *Backend) NodeGetAllocation() ([]nodes.NodeAllocation, error) {
	return nodes.GetNodesAllocation()
}
func (s *Backend) NodeGetMetricsByNameFromDB(name string) []metricsscraper.NodeMetrics {
	return metricsscraper.GetNodesMetricsDatabase(name)
}
func (s *Backend) PodGetMetricsByNameFromDB(name, namespace string) []metricsscraper.PodMetrics {
	return metricsscraper.GetPodMetricsDatabase(name, namespace)
}
func (s *Backend) PodGetMetrics(namespace, name string) (map[string]any, error) {
	return map[string]any{"data": []any{}}, nil
}

// --- node shell ---
type nodeShellSession struct {
	id          string
	nodeName    string
	stdinWriter *io.PipeWriter
	resize      chan remotecommand.TerminalSize
	cancel      context.CancelFunc
	cleanupOnce sync.Once
}
type nodeShellResizeQueue struct {
	ch <-chan remotecommand.TerminalSize
}

func (q nodeShellResizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-q.ch
	if !ok {
		return nil
	}
	return &size
}
func (s *Backend) ShellStartNodeSession(nodeName string) (string, error) {
	if nodeName == "" {
		return "", fmt.Errorf("node name is required")
	}
	// SetupShellAccess is already called by NodeSetupShell from the frontend.
	// Calling it here a second time wastes time but is safe.  We keep it only
	// as a fallback for callers that skip NodeSetupShell.
	if err := nodes.SetupShellAccess(nodeName); err != nil {
		return "", err
	}
	session, err := startNodeShellSession(nodeName)
	if err != nil {
		return "", err
	}
	return session.id, nil
}
func (s *Backend) ShellSendNodeInput(sessionID, b64Data string) error {
	session := getNodeShellSession(sessionID)
	if session == nil {
		return fmt.Errorf("shell session not found")
	}
	raw, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return fmt.Errorf("invalid base64 input")
	}
	if len(raw) == 0 {
		return nil
	}
	_, err = session.stdinWriter.Write(raw)
	return err
}
func (s *Backend) ShellResizeNodeSession(sessionID string, rows, cols int) error {
	session := getNodeShellSession(sessionID)
	if session == nil {
		return fmt.Errorf("shell session not found")
	}
	if rows <= 0 || cols <= 0 {
		return fmt.Errorf("rows and cols must be positive")
	}
	size := remotecommand.TerminalSize{Height: uint16(rows), Width: uint16(cols)}
	select {
	case session.resize <- size:
	default:
	}
	return nil
}
func (s *Backend) ShellStopNodeSession(sessionID string) error {
	session := getNodeShellSession(sessionID)
	if session == nil {
		return nil
	}
	session.cancel()
	return nil
}

// Aliases matching the names used by callBindingByName in NodeActionDrawer.tsx
func (s *Backend) StartNodeShellSession(nodeName string) (string, error) {
	return s.ShellStartNodeSession(nodeName)
}
func (s *Backend) SendNodeShellInput(sessionID, b64Data string) error {
	return s.ShellSendNodeInput(sessionID, b64Data)
}
func (s *Backend) ResizeNodeShellSession(sessionID string, rows, cols int) error {
	return s.ShellResizeNodeSession(sessionID, rows, cols)
}
func (s *Backend) StopNodeShellSession(sessionID string) error {
	return s.ShellStopNodeSession(sessionID)
}

// --- pod shell ---
func (s *Backend) ShellStartPodSession(namespace, podName, containerName string) (string, error) {
	if podName == "" {
		return "", fmt.Errorf("pod name is required")
	}
	session, err := startPodShellSession(namespace, podName, containerName)
	if err != nil {
		return "", err
	}
	return session.id, nil
}
func (s *Backend) ShellSendPodInput(sessionID, b64Data string) error {
	session := getPodShellSession(sessionID)
	if session == nil {
		return fmt.Errorf("pod shell session not found")
	}
	raw, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return fmt.Errorf("invalid base64 input")
	}
	if len(raw) == 0 {
		return nil
	}
	_, err = session.stdinWriter.Write(raw)
	return err
}
func (s *Backend) ShellResizePodSession(sessionID string, rows, cols int) error {
	session := getPodShellSession(sessionID)
	if session == nil {
		return fmt.Errorf("pod shell session not found")
	}
	if rows <= 0 || cols <= 0 {
		return fmt.Errorf("rows and cols must be positive")
	}
	size := remotecommand.TerminalSize{Height: uint16(rows), Width: uint16(cols)}
	select {
	case session.resize <- size:
	default:
	}
	return nil
}
func (s *Backend) ShellStopPodSession(sessionID string) error {
	session := getPodShellSession(sessionID)
	if session == nil {
		return nil
	}
	session.cancel()
	return nil
}

// --- port forwarding ---
func (s *Backend) PortForwardStart(namespace, podName, remotePort, localPort string) (PortForwardSession, error) {
	return StartPortForward(namespace, podName, remotePort, localPort)
}
func (s *Backend) PortForwardStop(sessionID string) error {
	return StopPortForward(sessionID)
}
func (s *Backend) PortForwardList() []PortForwardSession {
	return ListPortForwards()
}

// Aliases for pod shell used by PodActionDrawer.tsx
func (s *Backend) StartPodShellSession(namespace, podName, containerName string) (string, error) {
	return s.ShellStartPodSession(namespace, podName, containerName)
}
func (s *Backend) SendPodShellInput(sessionID, b64Data string) error {
	return s.ShellSendPodInput(sessionID, b64Data)
}
func (s *Backend) ResizePodShellSession(sessionID string, rows, cols int) error {
	return s.ShellResizePodSession(sessionID, rows, cols)
}
func (s *Backend) StopPodShellSession(sessionID string) error {
	return s.ShellStopPodSession(sessionID)
}
