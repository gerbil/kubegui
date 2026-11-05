package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kubegui/internal/db"
	"kubegui/internal/kubeclients"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/yaml"
)

const (
	argoDefaultNamespace = "argocd"
	argoFinalizerBase    = "resources-finalizer.argocd.argoproj.io"
	argoRefreshAnnotaton = "argocd.argoproj.io/refresh"
	argoOpTimeout        = 30 * time.Second
	argoDiffTimeout      = 60 * time.Second
)

var argoApplicationGVR = schema.GroupVersionResource{Group: "argoproj.io", Version: "v1alpha1", Resource: "applications"}

// ArgoAppInfo is a compact row for the Argo CD applications list.
type ArgoAppInfo struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	Project        string `json:"project"`
	SyncStatus     string `json:"syncStatus"`
	HealthStatus   string `json:"healthStatus"`
	RepoURL        string `json:"repoUrl"`
	Path           string `json:"path"`
	Chart          string `json:"chart"`
	TargetRevision string `json:"targetRevision"`
	SyncedRevision string `json:"syncedRevision"`
	DestServer     string `json:"destServer"`
	DestName       string `json:"destName"`
	DestNamespace  string `json:"destNamespace"`
	AutoSync       bool   `json:"autoSync"`
	SourceCount    int    `json:"sourceCount"`
	OperationPhase string `json:"operationPhase"`
	ReconciledAt   string `json:"reconciledAt"`
	CreatedAt      string `json:"createdAt"`
}

// ArgoSyncRequest mirrors the options offered by the Argo CD "Synchronize" panel.
type ArgoSyncRequest struct {
	Namespace       string             `json:"namespace"`
	Name            string             `json:"name"`
	Revision        string             `json:"revision"`
	Prune           bool               `json:"prune"`
	DryRun          bool               `json:"dryRun"`
	Force           bool               `json:"force"`
	ApplyOnly       bool               `json:"applyOnly"`
	Replace         bool               `json:"replace"`
	ServerSideApply bool               `json:"serverSideApply"`
	CreateNamespace bool               `json:"createNamespace"`
	Resources       []ArgoSyncResource `json:"resources"`
}

type ArgoSyncResource struct {
	Group     string `json:"group"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type ArgoRollbackRequest struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	ID        int64  `json:"id"`
	Prune     bool   `json:"prune"`
	DryRun    bool   `json:"dryRun"`
}

type ArgoDiffResult struct {
	Diff    string `json:"diff"`
	Changed bool   `json:"changed"`
}

func (s *Backend) ArgoListApps(namespace string) ([]ArgoAppInfo, error) {
	return listArgoApps(namespace)
}

func (s *Backend) ArgoGetApp(namespace, name string) (map[string]any, error) {
	return getArgoApp(namespace, name)
}

func argoClient() (dynamic.Interface, error) {
	return kubeclients.GetDynamicClient()
}

func argoNamespace(ns string) string {
	ns = strings.TrimSpace(ns)
	if ns == "" || ns == "all" || ns == "_" {
		return ""
	}
	return ns
}

func listArgoApps(namespace string) ([]ArgoAppInfo, error) {
	client, err := argoClient()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), argoOpTimeout)
	defer cancel()

	list, err := client.Resource(argoApplicationGVR).Namespace(argoNamespace(namespace)).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list Argo CD applications: %w", err)
	}

	rows := make([]ArgoAppInfo, 0, len(list.Items))
	for i := range list.Items {
		rows = append(rows, argoAppRow(&list.Items[i]))
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Name != rows[j].Name {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	return rows, nil
}

func argoAppRow(obj *unstructured.Unstructured) ArgoAppInfo {
	str := func(path ...string) string {
		v, _, _ := unstructured.NestedString(obj.Object, path...)
		return v
	}
	row := ArgoAppInfo{
		Name:           obj.GetName(),
		Namespace:      obj.GetNamespace(),
		Project:        str("spec", "project"),
		SyncStatus:     str("status", "sync", "status"),
		HealthStatus:   str("status", "health", "status"),
		SyncedRevision: str("status", "sync", "revision"),
		DestServer:     str("spec", "destination", "server"),
		DestName:       str("spec", "destination", "name"),
		DestNamespace:  str("spec", "destination", "namespace"),
		OperationPhase: str("status", "operationState", "phase"),
		ReconciledAt:   str("status", "reconciledAt"),
		CreatedAt:      obj.GetCreationTimestamp().Format(time.RFC3339),
	}
	if row.Project == "" {
		row.Project = "default"
	}
	if row.SyncStatus == "" {
		row.SyncStatus = "Unknown"
	}
	if row.HealthStatus == "" {
		row.HealthStatus = "Unknown"
	}

	source := map[string]any{}
	if src, found, _ := unstructured.NestedMap(obj.Object, "spec", "source"); found {
		source = src
		row.SourceCount = 1
	} else if srcs, found, _ := unstructured.NestedSlice(obj.Object, "spec", "sources"); found && len(srcs) > 0 {
		row.SourceCount = len(srcs)
		if first, ok := srcs[0].(map[string]any); ok {
			source = first
		}
	}
	row.RepoURL, _ = source["repoURL"].(string)
	row.Path, _ = source["path"].(string)
	row.Chart, _ = source["chart"].(string)
	row.TargetRevision, _ = source["targetRevision"].(string)

	_, row.AutoSync, _ = unstructured.NestedMap(obj.Object, "spec", "syncPolicy", "automated")
	return row
}

func getArgoApp(namespace, name string) (map[string]any, error) {
	client, err := argoClient()
	if err != nil {
		return nil, err
	}
	obj, err := getArgoAppObject(client, namespace, name)
	if err != nil {
		return nil, err
	}
	unstructured.RemoveNestedField(obj.Object, "metadata", "managedFields")
	return obj.Object, nil
}

func getArgoAppObject(client dynamic.Interface, namespace, name string) (*unstructured.Unstructured, error) {
	ns := argoNamespace(namespace)
	if ns == "" || strings.TrimSpace(name) == "" {
		return nil, errors.New("namespace and name are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), argoOpTimeout)
	defer cancel()
	return client.Resource(argoApplicationGVR).Namespace(ns).Get(ctx, name, metav1.GetOptions{})
}

func argoAppYAML(namespace, name string) (string, error) {
	obj, err := getArgoApp(namespace, name)
	if err != nil {
		return "", err
	}
	// Runtime state is not part of the editable manifest.
	delete(obj, "status")
	delete(obj, "operation")
	if meta, ok := obj["metadata"].(map[string]any); ok {
		for _, key := range []string{"resourceVersion", "uid", "generation", "creationTimestamp", "selfLink"} {
			delete(meta, key)
		}
	}
	out, err := yaml.Marshal(obj)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func parseArgoApplicationYAML(manifest string) (*unstructured.Unstructured, error) {
	if strings.TrimSpace(manifest) == "" {
		return nil, errors.New("yaml manifest is empty")
	}
	if bytes.Contains([]byte("\n"+manifest), []byte("\n---")) {
		docs := strings.Split("\n"+manifest, "\n---")
		nonEmpty := 0
		for _, d := range docs {
			if strings.TrimSpace(d) != "" {
				nonEmpty++
			}
		}
		if nonEmpty > 1 {
			return nil, errors.New("only a single Application document is supported")
		}
	}
	obj := map[string]any{}
	if err := yaml.Unmarshal([]byte(manifest), &obj); err != nil {
		return nil, fmt.Errorf("invalid yaml: %w", err)
	}
	u := &unstructured.Unstructured{Object: obj}
	if u.GetKind() != "Application" {
		return nil, fmt.Errorf("kind must be Application, got %q", u.GetKind())
	}
	if u.GroupVersionKind().Group != "argoproj.io" {
		return nil, fmt.Errorf("apiVersion must be argoproj.io/v1alpha1, got %q", u.GetAPIVersion())
	}
	if strings.TrimSpace(u.GetName()) == "" {
		return nil, errors.New("metadata.name is required")
	}
	if u.GetNamespace() == "" {
		u.SetNamespace(argoDefaultNamespace)
	}
	return u, nil
}

func createArgoApp(manifest string) (*unstructured.Unstructured, error) {
	u, err := parseArgoApplicationYAML(manifest)
	if err != nil {
		return nil, err
	}
	client, err := argoClient()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), argoOpTimeout)
	defer cancel()
	return client.Resource(argoApplicationGVR).Namespace(u.GetNamespace()).Create(ctx, u, metav1.CreateOptions{})
}

func updateArgoApp(manifest string) error {
	u, err := parseArgoApplicationYAML(manifest)
	if err != nil {
		return err
	}
	client, err := argoClient()
	if err != nil {
		return err
	}
	existing, err := getArgoAppObject(client, u.GetNamespace(), u.GetName())
	if err != nil {
		return err
	}
	u.SetResourceVersion(existing.GetResourceVersion())
	// Keep controller-owned state; the editor only exposes the manifest.
	for _, key := range []string{"status", "operation"} {
		if v, ok := existing.Object[key]; ok {
			u.Object[key] = v
		} else {
			delete(u.Object, key)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), argoOpTimeout)
	defer cancel()
	_, err = client.Resource(argoApplicationGVR).Namespace(u.GetNamespace()).Update(ctx, u, metav1.UpdateOptions{})
	return err
}

func patchArgoApp(client dynamic.Interface, namespace, name string, patch []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), argoOpTimeout)
	defer cancel()
	_, err := client.Resource(argoApplicationGVR).Namespace(argoNamespace(namespace)).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	return err
}

func argoOperationInProgress(obj *unstructured.Unstructured) bool {
	if _, found, _ := unstructured.NestedMap(obj.Object, "operation"); found {
		return true
	}
	phase, _, _ := unstructured.NestedString(obj.Object, "status", "operationState", "phase")
	return phase == "Running" || phase == "Terminating"
}

func syncArgoApp(req ArgoSyncRequest) error {
	client, err := argoClient()
	if err != nil {
		return err
	}
	obj, err := getArgoAppObject(client, req.Namespace, req.Name)
	if err != nil {
		return err
	}
	if argoOperationInProgress(obj) {
		return errors.New("another operation is already in progress for this application")
	}

	// A manual operation replaces the app's syncPolicy.syncOptions, so keep the ones this dialog doesn't manage.
	managed := map[string]bool{
		"ApplyOutOfSyncOnly=true": true, "Replace=true": true, "ServerSideApply=true": true, "CreateNamespace=true": true,
	}
	syncOptions := []any{}
	if existing, _, _ := unstructured.NestedStringSlice(obj.Object, "spec", "syncPolicy", "syncOptions"); len(existing) > 0 {
		for _, opt := range existing {
			if !managed[opt] {
				syncOptions = append(syncOptions, opt)
			}
		}
	}
	addOpt := func(enabled bool, opt string) {
		if enabled {
			syncOptions = append(syncOptions, opt)
		}
	}
	addOpt(req.ApplyOnly, "ApplyOutOfSyncOnly=true")
	addOpt(req.Replace, "Replace=true")
	addOpt(req.ServerSideApply, "ServerSideApply=true")
	addOpt(req.CreateNamespace, "CreateNamespace=true")

	sync := map[string]any{
		"prune":       req.Prune,
		"dryRun":      req.DryRun,
		"syncOptions": syncOptions,
	}
	if req.Force {
		sync["syncStrategy"] = map[string]any{"apply": map[string]any{"force": true}}
	}
	if rev := strings.TrimSpace(req.Revision); rev != "" {
		sync["revision"] = rev
	}
	if len(req.Resources) > 0 {
		resources := make([]any, 0, len(req.Resources))
		for _, r := range req.Resources {
			resources = append(resources, map[string]any{
				"group": r.Group, "kind": r.Kind, "name": r.Name, "namespace": r.Namespace,
			})
		}
		sync["resources"] = resources
	}
	return patchArgoOperation(client, obj, map[string]any{"sync": sync})
}

func rollbackArgoApp(req ArgoRollbackRequest) error {
	client, err := argoClient()
	if err != nil {
		return err
	}
	obj, err := getArgoAppObject(client, req.Namespace, req.Name)
	if err != nil {
		return err
	}
	if _, automated, _ := unstructured.NestedMap(obj.Object, "spec", "syncPolicy", "automated"); automated {
		return errors.New("rollback cannot be initiated while auto-sync is enabled; disable auto-sync first")
	}
	if argoOperationInProgress(obj) {
		return errors.New("another operation is already in progress for this application")
	}

	history, _, _ := unstructured.NestedSlice(obj.Object, "status", "history")
	var target map[string]any
	for _, item := range history {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if id, ok := entry["id"].(int64); ok && id == req.ID {
			target = entry
			break
		}
	}
	if target == nil {
		return fmt.Errorf("history entry %d not found", req.ID)
	}

	sync := map[string]any{"prune": req.Prune, "dryRun": req.DryRun}
	for _, key := range []string{"revision", "revisions", "source", "sources"} {
		if v, ok := target[key]; ok {
			sync[key] = v
		}
	}
	return patchArgoOperation(client, obj, map[string]any{"sync": sync})
}

func patchArgoOperation(client dynamic.Interface, obj *unstructured.Unstructured, op map[string]any) error {
	op["initiatedBy"] = map[string]any{"username": "kubegui"}
	patch, err := json.Marshal(map[string]any{"operation": op})
	if err != nil {
		return err
	}
	return patchArgoApp(client, obj.GetNamespace(), obj.GetName(), patch)
}

func refreshArgoApp(namespace, name string, hard bool) error {
	client, err := argoClient()
	if err != nil {
		return err
	}
	mode := "normal"
	if hard {
		mode = "hard"
	}
	patch, err := json.Marshal(map[string]any{"metadata": map[string]any{"annotations": map[string]any{argoRefreshAnnotaton: mode}}})
	if err != nil {
		return err
	}
	return patchArgoApp(client, namespace, name, patch)
}

// terminateArgoOperation stops a running sync the same way the Argo CD UI does.
func terminateArgoOperation(namespace, name string) error {
	client, err := argoClient()
	if err != nil {
		return err
	}
	obj, err := getArgoAppObject(client, namespace, name)
	if err != nil {
		return err
	}
	phase, _, _ := unstructured.NestedString(obj.Object, "status", "operationState", "phase")
	if phase != "Running" {
		return errors.New("no running operation to terminate")
	}
	patch, err := json.Marshal(map[string]any{"status": map[string]any{"operationState": map[string]any{"phase": "Terminating"}}})
	if err != nil {
		return err
	}
	return patchArgoApp(client, namespace, name, patch)
}

// deleteArgoApp supports the three Argo CD delete modes: foreground, background cascade, and non-cascading (orphan).
func deleteArgoApp(namespace, name, mode string) error {
	client, err := argoClient()
	if err != nil {
		return err
	}
	obj, err := getArgoAppObject(client, namespace, name)
	if err != nil {
		return err
	}

	kept := []string{}
	for _, f := range obj.GetFinalizers() {
		if f != argoFinalizerBase && !strings.HasPrefix(f, argoFinalizerBase+"/") {
			kept = append(kept, f)
		}
	}
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "foreground":
		kept = append(kept, argoFinalizerBase+"/foreground")
	case "background":
		kept = append(kept, argoFinalizerBase+"/background")
	case "orphan", "":
	default:
		return fmt.Errorf("unsupported delete mode %q", mode)
	}

	if !equalStringSets(kept, obj.GetFinalizers()) {
		patch, err := json.Marshal(map[string]any{"metadata": map[string]any{"finalizers": kept}})
		if err != nil {
			return err
		}
		if err := patchArgoApp(client, namespace, name, patch); err != nil {
			return err
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), argoOpTimeout)
	defer cancel()
	return client.Resource(argoApplicationGVR).Namespace(argoNamespace(namespace)).Delete(ctx, name, metav1.DeleteOptions{})
}

func equalStringSets(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]int{}
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		seen[v]--
	}
	for _, n := range seen {
		if n != 0 {
			return false
		}
	}
	return true
}

// diffArgoApp shells out to the argocd CLI in core mode, because rendering desired manifests needs the Argo CD repo-server logic.
func diffArgoApp(namespace, name string) (ArgoDiffResult, error) {
	bin, err := exec.LookPath("argocd")
	if err != nil {
		return ArgoDiffResult{}, errors.New("argocd CLI not found in PATH; install it to enable diff")
	}
	ns := argoNamespace(namespace)
	if ns == "" || strings.TrimSpace(name) == "" {
		return ArgoDiffResult{}, errors.New("namespace and name are required")
	}

	kubeconfig, cleanup, err := argoCoreKubeconfig(ns)
	if err != nil {
		return ArgoDiffResult{}, err
	}
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), argoDiffTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "app", "diff", ns+"/"+name, "--core", "--exit-code=false")
	cmd.Env = append(os.Environ(), "KUBECONFIG="+kubeconfig)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ArgoDiffResult{}, errors.New("argocd app diff timed out")
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return ArgoDiffResult{}, errors.New(msg)
	}
	out := stdout.String()
	return ArgoDiffResult{Diff: out, Changed: strings.TrimSpace(out) != ""}, nil
}

// argoCoreKubeconfig writes a temp kubeconfig whose current context points at the Argo CD namespace, as core mode requires.
func argoCoreKubeconfig(namespace string) (string, func(), error) {
	active, err := db.GetActiveClusterconfig()
	if err != nil {
		return "", nil, err
	}
	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: active.ConfigPath}
	cfg, err := rules.Load()
	if err != nil {
		return "", nil, err
	}
	ctxName := active.Context
	if ctxName == "" {
		ctxName = cfg.CurrentContext
	}
	c, ok := cfg.Contexts[ctxName]
	if !ok {
		return "", nil, fmt.Errorf("kube context %q not found", ctxName)
	}
	c.Namespace = namespace
	cfg.CurrentContext = ctxName

	dir, err := os.MkdirTemp("", "kubegui-argocd-")
	if err != nil {
		return "", nil, err
	}
	path := filepath.Join(dir, "config")
	if err := clientcmd.WriteToFile(*cfg, path); err != nil {
		_ = os.RemoveAll(dir)
		return "", nil, err
	}
	return path, func() { _ = os.RemoveAll(dir) }, nil
}
