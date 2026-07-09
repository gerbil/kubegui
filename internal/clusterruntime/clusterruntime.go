package clusterruntime

// clusterruntime manages the GlobalInformers lifecycle for the active cluster.
// It wires up Wails event emission, database access, and metrics scraping —
// dependencies that must not leak into the informers package (which is kept
// lean so its tests compile quickly).

import (
	"context"
	"fmt"
	"time"

	idb "kubegui/internal/db"
	"kubegui/internal/logger"
	"kubegui/internal/metricsscraper"
	"kubegui/internal/resources/informers"

	"github.com/wailsapp/wails/v3/pkg/application"
	"k8s.io/client-go/tools/clientcmd"
)

// GetGlobalManager returns the active GlobalInformers or nil.
func GetGlobalManager() *informers.GlobalInformers {
	return informers.GetGlobalManager()
}

func emitProgress(stage, message string, resourceCount int) {
	payload := map[string]any{"stage": stage, "message": message}
	if resourceCount > 0 {
		payload["resourceCount"] = resourceCount
	}
	application.Get().Event.Emit("informerProgress", payload)
}

// StartForActiveCluster starts the GlobalInformers for the currently active
// cluster config. Idempotent: if already running for the same cluster it
// returns immediately.
func StartForActiveCluster(ctx context.Context) (*informers.GlobalInformers, error) {
	active, err := idb.GetActiveClusterconfig()
	if err != nil {
		return nil, err
	}
	if active.ConfigPath == "" || active.Context == "" {
		return nil, fmt.Errorf("active cluster config is incomplete")
	}

	clusterKey := active.ConfigPath + "|" + active.Context

	// Fast check: already running for this cluster.
	if existing := informers.GetGlobalManager(); existing != nil && informers.GetGlobalManagerClusterKey() == clusterKey {
		emitProgress("started", "Already connected", 0)
		return existing, nil
	}

	// Stop any previous manager.
	if prev := informers.GetGlobalManager(); prev != nil {
		if stopErr := prev.Stop(); stopErr != nil {
			logger.Logger.Warn("failed to stop previous global informer manager", "err", stopErr)
		}
		informers.SetGlobalManager(nil, "")
	}

	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: active.ConfigPath}
	overrides := &clientcmd.ConfigOverrides{CurrentContext: active.Context}
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides).ClientConfig()
	if err != nil {
		return nil, err
	}

	manager, err := informers.NewGlobalInformers(cfg)
	if err != nil {
		return nil, err
	}

	// Wire up Wails event emission and metrics scraping callbacks.
	manager.OnEvent = func(name string, data map[string]any) {
		application.Get().Event.Emit(name, data)
	}
	manager.OnCacheSynced = func() {
		metricsscraper.Scrape()
	}

	// Stage 1: discover resources.
	emitProgress("discovering", "Discovering cluster resources…", 0)
	discoverCtx, discoverCancel := context.WithTimeout(ctx, 90*time.Second)
	defer discoverCancel()
	if err := manager.DiscoverStandardReadableResources(discoverCtx); err != nil {
		return nil, err
	}
	resourceCount := len(manager.GetResources())

	informers.SetGlobalManager(manager, clusterKey)

	emitProgress("discovered", fmt.Sprintf("Found %d resources", resourceCount), resourceCount)

	// Stage 2: start informers (cache warms up asynchronously).
	if err := manager.Start(ctx); err != nil {
		return nil, err
	}

	emitProgress("started", "Informers started, caches warming…", 0)

	return manager, nil
}

// EnableCRDForActiveCluster enables CRD informers on the running manager.
func EnableCRDForActiveCluster(ctx context.Context) error {
	manager := informers.GetGlobalManager()
	if manager == nil {
		return fmt.Errorf("global informer manager not started")
	}
	return manager.EnableCRDInformers(ctx)
}

// StopForActiveCluster stops and clears the running manager.
func StopForActiveCluster() error {
	manager := informers.GetGlobalManager()
	if manager == nil {
		return nil
	}
	err := manager.Stop()
	informers.SetGlobalManager(nil, "")
	return err
}

