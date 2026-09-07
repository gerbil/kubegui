package informers

import "sync"

// manager.go holds the package-level GlobalInformers singleton.
// This file has NO wails or database dependencies so the informers package
// stays light for tests. The service layer (services/informer_manager.go)
// owns lifecycle (start/stop/wails events) and calls SetGlobalManager.

var globalRuntime struct {
	mu         sync.RWMutex
	clusterKey string
	manager    *GlobalInformers
}

// GetGlobalManager returns the active GlobalInformers singleton, or nil.
func GetGlobalManager() *GlobalInformers {
	globalRuntime.mu.RLock()
	defer globalRuntime.mu.RUnlock()
	return globalRuntime.manager
}

// SetGlobalManager replaces the active singleton. Passing nil clears it.
// clusterKey is an opaque string used by the service layer to detect
// whether the cluster has changed (e.g. "configPath|context").
func SetGlobalManager(m *GlobalInformers, clusterKey string) {
	globalRuntime.mu.Lock()
	defer globalRuntime.mu.Unlock()
	globalRuntime.manager = m
	globalRuntime.clusterKey = clusterKey
}

// GetGlobalManagerClusterKey returns the cluster key associated with the
// current manager, or "" if none is set.
func GetGlobalManagerClusterKey() string {
	globalRuntime.mu.RLock()
	defer globalRuntime.mu.RUnlock()
	return globalRuntime.clusterKey
}

