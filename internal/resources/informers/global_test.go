package informers

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func TestDiscoverReadableResourcesSmoke(t *testing.T) {
	rest.SetDefaultWarningHandler(rest.NoWarnings{})
	ctx := context.Background()

	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	configOverrides := &clientcmd.ConfigOverrides{}

	cfg, err := clientcmd.
		NewNonInteractiveDeferredLoadingClientConfig(
			loadingRules,
			configOverrides,
		).
		ClientConfig()
	require.NoError(t, err)

	gi, err := NewGlobalInformers(cfg)
	require.NoError(t, err)

	err = gi.DiscoverStandardReadableResources(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, gi.Resources)
	t.Log("Number of resources in the cluster - ", len(gi.Resources))

	err = gi.Start(ctx)
	require.NoError(t, err)
	t.Log("Informers started (caches warming in background)")
}

func TestGlobalInformersSubscribeAndDefinitionsSmoke(t *testing.T) {
	rest.SetDefaultWarningHandler(rest.NoWarnings{})
	ctx := context.Background()

	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	configOverrides := &clientcmd.ConfigOverrides{}

	cfg, err := clientcmd.
		NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).
		ClientConfig()
	require.NoError(t, err)

	gi, err := NewGlobalInformers(cfg)
	require.NoError(t, err)

	err = gi.DiscoverAllReadableResources(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, gi.GetResources())

	defs := gi.GetCRDDefinitions()
	t.Logf("crd definitions discovered: %d", len(defs))

	err = gi.Start(ctx)
	require.NoError(t, err)

	err = gi.SubscribeResource("namespaces")
	require.NoError(t, err)

	status := gi.Status()
	require.True(t, status.Started)
	require.NotEmpty(t, status.Subscriptions)
	require.Contains(t, status.Subscriptions, "namespaces")

	gi.UnsubscribeResource("namespaces")
	require.NotContains(t, gi.Subscriptions(), "namespaces")
}

// TestGlobalInformersListFromCacheSmoke verifies that ListFromCache returns
// items from the in-memory informer store after the factory has synced.
func TestGlobalInformersListFromCacheSmoke(t *testing.T) {
	rest.SetDefaultWarningHandler(rest.NoWarnings{})
	ctx := context.Background()

	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	configOverrides := &clientcmd.ConfigOverrides{}

	cfg, err := clientcmd.
		NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).
		ClientConfig()
	require.NoError(t, err)

	gi, err := NewGlobalInformers(cfg)
	require.NoError(t, err)

	// Discovery must run before Start so the factory knows which GVRs to watch.
	err = gi.DiscoverStandardReadableResources(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, gi.Resources, "expected at least one discoverable resource")

	err = gi.Start(ctx)
	require.NoError(t, err)

	// Wait for all informer caches to sync before reading from cache.
	syncCtx, syncCancel := context.WithTimeout(ctx, 60*time.Second)
	defer syncCancel()
	err = gi.WaitForSync(syncCtx.Done())
	require.NoError(t, err, "informer caches did not sync within timeout")

	// namespaces is cluster-scoped and always present — ideal for a smoke target.
	namespaces, err := gi.ListFromCache("namespaces", "")
	require.NoError(t, err)
	require.NotEmpty(t, namespaces, "expected at least one namespace in cache")
	t.Logf("namespaces from cache: %d", len(namespaces))

	// Each item must carry a metadata.name field.
	for _, ns := range namespaces {
		meta, ok := ns["metadata"].(map[string]any)
		require.True(t, ok, "namespace item must have a metadata field")
		name, ok := meta["name"].(string)
		require.True(t, ok && name != "", "namespace metadata.name must be a non-empty string")
	}

	// Verify unknown resource returns an error.
	_, err = gi.ListFromCache("nonexistent-resource-xyz", "")
	require.Error(t, err, "ListFromCache should error for an unknown resource name")

	// Verify namespace-scoped filtering works for a namespaced resource (pods).
	// WaitForSync above guarantees the pods informer is ready.
	pods, err := gi.ListFromCache("pods", "kube-system")
	require.NoError(t, err, "pods cache must be ready after WaitForSync")
	for _, pod := range pods {
		meta, ok := pod["metadata"].(map[string]any)
		require.True(t, ok)
		require.Equal(t, "kube-system", meta["namespace"],
			"namespace filter should restrict pod results to kube-system")
	}
	t.Logf("pods in kube-system from cache: %d", len(pods))
}
