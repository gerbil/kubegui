package informers

import (
	"context"
	"fmt"
	"kubegui/internal/logger"
	"sort"
	"strings"
	"sync"
	"time"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	cachedmemory "k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
)

type ResourceInfo struct {
	Name       string
	GVR        schema.GroupVersionResource
	Kind       string
	Namespaced bool
	Verbs      []string
	Source     string
}

type CRDDefinition struct {
	Name          string      `json:"name"`
	Group         string      `json:"group"`
	Kind          string      `json:"kind"`
	Plural        string      `json:"plural"`
	Scope         string      `json:"scope"`
	Versions      []string    `json:"versions"`
	ShortName     string      `json:"shortName,omitempty"`
	Columns       []string    `json:"columns,omitempty"`       // AdditionalPrinterColumns names (Age excluded), kept for older UI code.
	ColumnDetails []CRDColumn `json:"columnDetails,omitempty"` // Full AdditionalPrinterColumns metadata used to render CRD resource tables.
}

type CRDColumn struct {
	Name        string `json:"name"`
	JSONPath    string `json:"jsonPath,omitempty"`
	Type        string `json:"type,omitempty"`
	Format      string `json:"format,omitempty"`
	Description string `json:"description,omitempty"`
	Priority    int32  `json:"priority,omitempty"`
}

type GlobalStatus struct {
	Started       bool     `json:"started"`
	Synced        bool     `json:"synced"`
	Tracked       int      `json:"tracked"`
	Subscriptions []string `json:"subscriptions"`
	PendingEvents int      `json:"pendingEvents"`
	LastError     string   `json:"lastError,omitempty"`
	LastSyncAt    string   `json:"lastSyncAt,omitempty"`
}

type globalInformerEvent struct {
	resource string
	event    string
	payload  map[string]any
}

type GlobalInformers struct {
	cfg          *rest.Config
	clientset    kubernetes.Interface
	disco        discovery.DiscoveryInterface
	dyn          dynamic.Interface
	extClientset apiextensionsclientset.Interface

	mu             sync.RWMutex
	Resources      []ResourceInfo
	resourceByName map[string]ResourceInfo
	crdDefs        []CRDDefinition

	informers map[schema.GroupVersionResource]cache.SharedIndexInformer

	factory dynamicinformer.DynamicSharedInformerFactory

	stopFn        context.CancelFunc
	runDone       <-chan struct{}
	started       bool
	synced        bool
	lastError     string
	lastSyncAt    time.Time
	subscriptions map[string]struct{}
	queue         chan globalInformerEvent

	// OnEvent is called to broadcast events to the UI layer (e.g. Wails events).
	// Nil is a no-op — safe for tests.
	OnEvent func(name string, data map[string]any)
	// OnCacheSynced is called once all informer caches have synced successfully.
	// Nil is a no-op — safe for tests.
	OnCacheSynced func()
}

// emit fires OnEvent if set; no-op when nil (safe for tests).
func (g *GlobalInformers) emit(name string, data map[string]any) {
	if g.OnEvent != nil {
		g.OnEvent(name, data)
	}
}

func NewGlobalInformers(cfg *rest.Config) (*GlobalInformers, error) {
	clientset, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}

	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}

	extClient, err := apiextensionsclientset.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}

	factory := dynamicinformer.NewDynamicSharedInformerFactory(dyn, 0)

	return &GlobalInformers{
		cfg:            cfg,
		clientset:      clientset,
		disco:          cachedmemory.NewMemCacheClient(clientset.Discovery()),
		dyn:            dyn,
		extClientset:   extClient,
		factory:        factory,
		informers:      map[schema.GroupVersionResource]cache.SharedIndexInformer{},
		resourceByName: map[string]ResourceInfo{},
		subscriptions:  map[string]struct{}{},
		queue:          make(chan globalInformerEvent, 4096),
	}, nil
}

func (g *GlobalInformers) Start(ctx context.Context) error {
	g.mu.Lock()
	if g.started {
		g.mu.Unlock()
		return nil
	}
	g.mu.Unlock()

	if err := g.ensureDiscovered(ctx); err != nil {
		return err
	}

	g.mu.RLock()
	resources := append([]ResourceInfo(nil), g.Resources...)
	g.mu.RUnlock()

	runCtx, cancel := context.WithCancel(context.Background())

	g.mu.Lock()
	g.stopFn = cancel
	g.runDone = runCtx.Done()
	g.lastError = ""
	g.mu.Unlock()

	for _, resource := range resources {
		if !hasVerb(resource.Verbs, "watch") {
			continue
		}
		informer := g.factory.ForResource(resource.GVR).Informer()
		resourceName := resource.Name
		_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc: func(obj any) {
				g.handleInformerObject(resourceName, obj, "add")
			},
			UpdateFunc: func(_, newObj any) {
				g.handleInformerObject(resourceName, newObj, "update")
			},
			DeleteFunc: func(obj any) {
				g.handleInformerObject(resourceName, obj, "delete")
			},
		})
		g.mu.Lock()
		g.informers[resource.GVR] = informer
		g.mu.Unlock()
	}

	g.factory.Start(runCtx.Done())

	// Mark as started immediately so callers can use ListLive as fallback
	// while the cache warms up asynchronously.
	g.mu.Lock()
	g.started = true
	g.synced = false
	g.mu.Unlock()

	go g.runEmitter(runCtx.Done())

	// Wait for cache sync in the background; update synced flag when done.
	// We continue even if some informers fail to sync — partial data is better
	// than no data, and the synced event must always fire so the frontend refreshes.
	go func() {
		syncCtx, syncCancel := context.WithTimeout(context.Background(), 75*time.Second)
		defer syncCancel()

		var failedGVRs []string
		for gvr, ok := range g.factory.WaitForCacheSync(syncCtx.Done()) {
			if !ok {
				failedGVRs = append(failedGVRs, gvr.String())
			}
		}

		partial := len(failedGVRs) > 0
		timedOut := syncCtx.Err() == context.DeadlineExceeded

		g.mu.Lock()
		// Keep app usable with partial informer cache: emit degraded error but mark
		// runtime synced so frontend does not remain blocked on "started" forever.
		g.synced = true
		g.lastSyncAt = time.Now().UTC()
		if partial {
			if timedOut {
				g.lastError = fmt.Sprintf("cache sync timeout (75s), unsynced: %s", strings.Join(failedGVRs, ", "))
			} else {
				g.lastError = fmt.Sprintf("partial cache sync, unsynced: %s", strings.Join(failedGVRs, ", "))
			}
		} else {
			g.lastError = ""
		}
		g.mu.Unlock()

		if partial {
			logger.Logger.Warn("informer cache sync partial", "timedOut", timedOut, "failedGVRs", strings.Join(failedGVRs, ", "))
			g.emit("informerProgress", map[string]any{
				"stage":   "synced",
				"message": fmt.Sprintf("Caches partially synced (%d unsynced resources)", len(failedGVRs)),
			})
		} else {
			g.emit("informerProgress", map[string]any{
				"stage":   "synced",
				"message": "All caches synced",
			})
		}

		// Start metrics scraping once initial sync pass completes.
		if g.OnCacheSynced != nil {
			g.OnCacheSynced()
		}
	}()

	return nil
}

func (g *GlobalInformers) Stop() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.stopFn != nil {
		g.stopFn()
		g.stopFn = nil
	}

	g.started = false
	g.synced = false
	g.runDone = nil
	g.factory = dynamicinformer.NewDynamicSharedInformerFactory(g.dyn, 0)
	g.informers = map[schema.GroupVersionResource]cache.SharedIndexInformer{}
	g.queue = make(chan globalInformerEvent, 4096)
	return nil
}

// EnableCRDInformers discovers CRD-backed resources and starts informers for them.
// Call this only after Start() when the UI opts in to CRD streaming.
func (g *GlobalInformers) EnableCRDInformers(ctx context.Context) error {
	g.mu.RLock()
	started := g.started
	runDone := g.runDone
	g.mu.RUnlock()
	if !started || runDone == nil {
		return fmt.Errorf("global informers are not started")
	}

	if err := g.DiscoverAllReadableResources(ctx); err != nil {
		return err
	}

	g.mu.RLock()
	resources := append([]ResourceInfo(nil), g.Resources...)
	g.mu.RUnlock()

	for _, resource := range resources {
		if !hasVerb(resource.Verbs, "watch") {
			continue
		}
		informer := g.factory.ForResource(resource.GVR).Informer()
		g.mu.Lock()
		if _, exists := g.informers[resource.GVR]; !exists {
			resourceName := resource.Name
			_, _ = informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
				AddFunc: func(obj any) {
					g.handleInformerObject(resourceName, obj, "add")
				},
				UpdateFunc: func(_, newObj any) {
					g.handleInformerObject(resourceName, newObj, "update")
				},
				DeleteFunc: func(obj any) {
					g.handleInformerObject(resourceName, obj, "delete")
				},
			})
			g.informers[resource.GVR] = informer
		}
		g.mu.Unlock()
	}

	g.factory.Start(runDone)
	for gvr, synced := range g.factory.WaitForCacheSync(runDone) {
		if !synced {
			return fmt.Errorf("cache sync failed for %s", gvr.String())
		}
	}

	g.mu.Lock()
	g.lastSyncAt = time.Now().UTC()
	g.mu.Unlock()
	return nil
}

func (g *GlobalInformers) DiscoverAllReadableResources(ctx context.Context) error {
	return g.discoverResources(ctx, true)
}

func (g *GlobalInformers) DiscoverStandardReadableResources(ctx context.Context) error {
	return g.discoverResources(ctx, false)
}

func (g *GlobalInformers) discoverResources(ctx context.Context, includeCRDs bool) error {
	// CRD ownership lookup is best-effort. On clusters where the CRD endpoint is
	// slow or RBAC-restricted it will time out — skip gracefully with an empty set
	// (no resources get filtered as CRD-backed, which is safe for standard discovery).
	crdOwned := map[string]struct{}{}
	if rawCRDs, crdErr := g.crdOwnedResourceSet(ctx); crdErr == nil {
		crdOwned = rawCRDs
	}

	lists, err := g.disco.ServerPreferredResources()
	if err != nil && len(lists) == 0 {
		return fmt.Errorf("server discovery failed: %w", err)
	}

	var out []ResourceInfo

	for _, list := range lists {
		gv, err := schema.ParseGroupVersion(list.GroupVersion)
		if err != nil {
			continue
		}

		for _, apiResource := range list.APIResources {
			if shouldSkipAPIResourceForGlobal(gv, apiResource) {
				continue
			}

			key := resourceKey(gv.Group, gv.Version, apiResource.Name)
			_, isCRDBacked := crdOwned[key]
			if !includeCRDs && isCRDBacked {
				continue
			}

			gvr := schema.GroupVersionResource{
				Group:    gv.Group,
				Version:  gv.Version,
				Resource: apiResource.Name,
			}

			// Trust the API server's verb declarations — probing each resource
			// with canListResource added 20-30 s on slow clusters.

			source := "standard"
			if isCRDBacked {
				source = "crd"
			}

			out = append(out, ResourceInfo{
				Name:       apiResource.Name,
				GVR:        gvr,
				Kind:       apiResource.Kind,
				Namespaced: apiResource.Namespaced,
				Verbs:      apiResource.Verbs,
				Source:     source,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Name == out[j].Name {
			return out[i].GVR.String() < out[j].GVR.String()
		}
		return out[i].Name < out[j].Name
	})

	// CRD definitions are best-effort — skip gracefully if not accessible.
	defs, err := g.loadCRDDefinitions(ctx)
	if err != nil {
		defs = nil
	}

	resourceByName := make(map[string]ResourceInfo, len(out))
	for _, item := range out {
		existing, ok := resourceByName[item.Name]
		if !ok {
			resourceByName[item.Name] = item
			continue
		}
		// When multiple resources share the same name (e.g. core v1/pods vs
		// metrics.k8s.io/v1beta1/pods), prefer the one most useful for caching:
		// 1. Prefer resources that have the "watch" verb (watchable = cacheable).
		// 2. Among equal watchability, prefer the core API group (empty group).
		existingWatch := hasVerb(existing.Verbs, "watch")
		itemWatch := hasVerb(item.Verbs, "watch")
		coreWins := item.GVR.Group == "" && existing.GVR.Group != ""
		if (!existingWatch && itemWatch) || (existingWatch == itemWatch && coreWins) {
			resourceByName[item.Name] = item
		}
	}

	g.mu.Lock()
	g.Resources = out
	g.resourceByName = resourceByName
	g.crdDefs = defs
	g.mu.Unlock()

	return nil
}

func (g *GlobalInformers) GetResources() []ResourceInfo {
	g.mu.RLock()
	defer g.mu.RUnlock()

	return append([]ResourceInfo(nil), g.Resources...)
}

func (g *GlobalInformers) GetCRDDefinitions() []CRDDefinition {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return append([]CRDDefinition(nil), g.crdDefs...)
}

func (g *GlobalInformers) SubscribeResource(resource string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if _, ok := g.resourceByName[resource]; !ok {
		return fmt.Errorf("resource not tracked: %s", resource)
	}
	g.subscriptions[resource] = struct{}{}
	return nil
}

func (g *GlobalInformers) UnsubscribeResource(resource string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.subscriptions, resource)
}

func (g *GlobalInformers) Subscriptions() []string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	result := make([]string, 0, len(g.subscriptions))
	for resource := range g.subscriptions {
		result = append(result, resource)
	}
	sort.Strings(result)
	return result
}

func (g *GlobalInformers) Status() GlobalStatus {
	g.mu.RLock()
	defer g.mu.RUnlock()

	out := GlobalStatus{
		Started:       g.started,
		Synced:        g.synced,
		Tracked:       len(g.Resources),
		Subscriptions: make([]string, 0, len(g.subscriptions)),
		PendingEvents: len(g.queue),
		LastError:     g.lastError,
	}
	if !g.lastSyncAt.IsZero() {
		out.LastSyncAt = g.lastSyncAt.UTC().Format(time.RFC3339)
	}
	for resource := range g.subscriptions {
		out.Subscriptions = append(out.Subscriptions, resource)
	}
	sort.Strings(out.Subscriptions)
	return out
}

func (g *GlobalInformers) canListResource(ctx context.Context, gvr schema.GroupVersionResource, namespaced bool) bool {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var ri dynamic.ResourceInterface

	if namespaced {
		ri = g.dyn.Resource(gvr).Namespace(metav1.NamespaceAll)
	} else {
		ri = g.dyn.Resource(gvr)
	}

	_, err := ri.List(ctx, metav1.ListOptions{
		Limit: 1,
	})

	return err == nil
}

func (g *GlobalInformers) crdOwnedResourceSet(ctx context.Context) (map[string]struct{}, error) {
	crds, err := g.extClientset.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	out := make(map[string]struct{}, len(crds.Items))

	for _, crd := range crds.Items {
		addCRDToSet(out, crd)
	}

	return out, nil
}

func (g *GlobalInformers) loadCRDDefinitions(ctx context.Context) ([]CRDDefinition, error) {
	crds, err := g.extClientset.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list CRD definitions: %w", err)
	}

	out := make([]CRDDefinition, 0, len(crds.Items))
	for _, item := range crds.Items {
		versions := make([]string, 0, len(item.Spec.Versions))
		for _, version := range item.Spec.Versions {
			if version.Served {
				versions = append(versions, version.Name)
			}
		}
		sort.Strings(versions)

		def := CRDDefinition{
			Name:     item.Name,
			Group:    item.Spec.Group,
			Kind:     item.Spec.Names.Kind,
			Plural:   item.Spec.Names.Plural,
			Scope:    string(item.Spec.Scope),
			Versions: versions,
		}
		if len(item.Spec.Names.ShortNames) > 0 {
			def.ShortName = item.Spec.Names.ShortNames[0]
		}
		// Extract AdditionalPrinterColumns from first served version (skip Age/Image).
		// Keep both the legacy name list and the full metadata so the UI can evaluate
		// CRD-declared JSONPaths generically instead of guessing fields from labels.
		for _, ver := range item.Spec.Versions {
			if ver.Served {
				for _, col := range ver.AdditionalPrinterColumns {
					n := col.Name
					if strings.EqualFold(n, "age") || strings.EqualFold(n, "image") {
						continue
					}
					def.Columns = append(def.Columns, n)
					def.ColumnDetails = append(def.ColumnDetails, CRDColumn{
						Name:        n,
						JSONPath:    col.JSONPath,
						Type:        col.Type,
						Format:      col.Format,
						Description: col.Description,
						Priority:    col.Priority,
					})
				}
				break
			}
		}
		out = append(out, def)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Group == out[j].Group {
			return out[i].Plural < out[j].Plural
		}
		return out[i].Group < out[j].Group
	})

	return out, nil
}

func (g *GlobalInformers) WaitForSync(stopCh <-chan struct{}) error {
	g.mu.RLock()
	defer g.mu.RUnlock()

	funcs := make([]cache.InformerSynced, 0, len(g.informers))

	for _, informer := range g.informers {
		funcs = append(funcs, informer.HasSynced)
	}

	if !cache.WaitForCacheSync(stopCh, funcs...) {
		return fmt.Errorf("one or more informers failed to sync")
	}

	return nil
}

// ListFromCache returns unstructured objects for a standard Kubernetes resource
// directly from the in-memory informer store — no Kubernetes API round-trip.
//
// resource must be a well-known standard resource name (e.g. "pods", "namespaces").
// namespace filters results; pass "" or "all" to return items across all namespaces.
func (g *GlobalInformers) ListFromCache(resource, namespace string) ([]map[string]any, error) {
	info, err := g.resolveResource(resource)
	if err != nil {
		return nil, err
	}

	g.mu.RLock()
	inf, ok := g.informers[info.GVR]
	g.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("resource %q is not currently watched", resource)
	}

	raw := inf.GetStore().List()
	result := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		obj, ok := item.(*unstructured.Unstructured)
		if !ok {
			continue
		}
		if shouldFilterNamespace(namespace, info.Namespaced) && obj.GetNamespace() != namespace {
			continue
		}
		result = append(result, obj.Object)
	}
	return result, nil
}

func (g *GlobalInformers) ListLive(ctx context.Context, resource, namespace string) ([]map[string]any, error) {
	info, err := g.resolveResource(resource)
	if err != nil {
		return nil, err
	}

	ri := g.resourceInterface(info, namespace)
	list, err := ri.List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]map[string]any, 0, len(list.Items))
	for _, item := range list.Items {
		result = append(result, item.Object)
	}
	return result, nil
}

func (g *GlobalInformers) GetDetails(ctx context.Context, resource, namespace, name string) (map[string]any, error) {
	info, err := g.resolveResource(resource)
	if err != nil {
		return nil, err
	}

	ri := g.resourceInterface(info, namespace)
	obj, err := ri.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return obj.Object, nil
}

func (g *GlobalInformers) Edit(ctx context.Context, resource, namespace, name string, object map[string]any) (map[string]any, error) {
	info, err := g.resolveResource(resource)
	if err != nil {
		return nil, err
	}

	ri := g.resourceInterface(info, namespace)
	existing, err := ri.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	meta, ok := object["metadata"].(map[string]any)
	if !ok || meta == nil {
		meta = map[string]any{}
		object["metadata"] = meta
	}
	meta["name"] = name
	if info.Namespaced && namespace != "" && namespace != "all" && namespace != "_" {
		meta["namespace"] = namespace
	}
	meta["resourceVersion"] = existing.GetResourceVersion()

	updated, err := ri.Update(ctx, &unstructured.Unstructured{Object: object}, metav1.UpdateOptions{})
	if err != nil {
		return nil, err
	}
	return updated.Object, nil
}

func (g *GlobalInformers) ensureDiscovered(ctx context.Context) error {
	g.mu.RLock()
	hasResources := len(g.Resources) > 0
	g.mu.RUnlock()
	if hasResources {
		return nil
	}
	return g.DiscoverStandardReadableResources(ctx)
}

func (g *GlobalInformers) resolveResource(resource string) (ResourceInfo, error) {
	name := strings.TrimSpace(strings.ToLower(resource))

	// Special case: customresourcedefinitions is excluded from informer tracking
	// (to avoid self-referential watch loops) but must still be resolvable for
	// ResourceGetDetails calls from the CRD definition drawer.
	if name == "customresourcedefinitions" {
		return ResourceInfo{
			Name:       "customresourcedefinitions",
			GVR:        schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
			Kind:       "CustomResourceDefinition",
			Namespaced: false,
			Verbs:      []string{"get", "list", "watch", "update", "patch", "delete"},
			Source:     "standard",
		}, nil
	}
	g.mu.RLock()
	defer g.mu.RUnlock()

	info, ok := g.resourceByName[name]
	if ok {
		return info, nil
	}

	// Fall back: search loaded CRD definitions for a matching plural name so that
	// CRD-backed resources can be listed via the dynamic client even when the CRD
	// informers have not been started yet (i.e. InformerEnableCRD was never called).
	for _, def := range g.crdDefs {
		if strings.ToLower(def.Plural) == name {
			version := ""
			if len(def.Versions) > 0 {
				version = def.Versions[0]
			}
			return ResourceInfo{
				Name:       def.Plural,
				GVR:        schema.GroupVersionResource{Group: def.Group, Version: version, Resource: def.Plural},
				Kind:       def.Kind,
				Namespaced: def.Scope == "Namespaced",
				Verbs:      []string{"get", "list", "watch"},
				Source:     "crd",
			}, nil
		}
	}

	return ResourceInfo{}, fmt.Errorf("resource not tracked: %s", resource)
}

func (g *GlobalInformers) resourceInterface(info ResourceInfo, namespace string) dynamic.ResourceInterface {
	resource := g.dyn.Resource(info.GVR)
	if shouldFilterNamespace(namespace, info.Namespaced) {
		return resource.Namespace(namespace)
	}
	return resource
}

func shouldFilterNamespace(namespace string, namespaced bool) bool {
	if !namespaced {
		return false
	}
	ns := strings.TrimSpace(namespace)
	if ns == "" || ns == "all" || ns == "_" {
		return false
	}
	return true
}

func shouldSkipAPIResourceForGlobal(gv schema.GroupVersion, apiResource metav1.APIResource) bool {
	if strings.Contains(apiResource.Name, "/") {
		return true
	}
	if apiResource.Name == "" || apiResource.Kind == "" {
		return true
	}
	if !hasVerb(apiResource.Verbs, "list") {
		return true
	}
	if gv.Group == "apiextensions.k8s.io" && apiResource.Name == "customresourcedefinitions" {
		return true
	}

	if logger.Logger != nil {
		logger.Logger.Debug(
			"resource discovered",
			"group", gv.Group,
			"version", gv.Version,
			"name", apiResource.Name,
			"kind", apiResource.Kind,
			"verbs", apiResource.Verbs,
		)
	}

	return false
}

func (g *GlobalInformers) handleInformerObject(resource string, obj any, event string) {
	g.mu.RLock()
	_, subscribed := g.subscriptions[resource]
	queue := g.queue
	g.mu.RUnlock()
	if !subscribed {
		return
	}

	item, ok := obj.(*unstructured.Unstructured)
	if !ok {
		if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
			deletedObj, castOk := tombstone.Obj.(*unstructured.Unstructured)
			if !castOk {
				return
			}
			item = deletedObj
		} else {
			return
		}
	}

	payload := map[string]any{
		"uid":               string(item.GetUID()),
		"name":              item.GetName(),
		"namespace":         item.GetNamespace(),
		"kind":              item.GetKind(),
		"apiVersion":        item.GetAPIVersion(),
		"creationTimestamp": item.GetCreationTimestamp().UTC().Format(time.RFC3339),
	}

	select {
	case queue <- globalInformerEvent{resource: resource, event: event, payload: payload}:
	default:
		// Drop event if the queue is full to protect backend responsiveness.
	}
}

func (g *GlobalInformers) runEmitter(stop <-chan struct{}) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	batch := make([]globalInformerEvent, 0, 256)

	flush := func() {
		if len(batch) == 0 {
			return
		}
		// Deduplicate: emit at most ONE notification per resource per flush cycle.
		// During initial cache warm-up the queue can contain hundreds of "add" events
		// for the same resource (e.g. 500 pod additions). Each frontend hook reacting
		// to every event causes thousands of Wails runtime POSTs. One "something
		// changed in <resource>" notification per 250 ms flush is sufficient.
		seen := make(map[string]struct{}, len(batch))
		for i := range batch {
			e := batch[i]
			if _, already := seen[e.resource]; already {
				continue
			}
			seen[e.resource] = struct{}{}
			g.emit(fmt.Sprintf("%sInformerChanged", e.resource), map[string]any{
				"event":    e.event,
				"resource": e.resource,
				"item":     e.payload,
			})
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-stop:
			flush()
			return
		case e := <-g.queue:
			batch = append(batch, e)
			if len(batch) >= 256 {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}
