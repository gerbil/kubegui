package resourceops

import (
	"context"
	"fmt"

	"kubegui/internal/resources/informers"
)

// List returns objects from informer cache first, with live API fallback.
func List(ctx context.Context, manager *informers.GlobalInformers, resource, namespace string) ([]map[string]any, error) {
	if manager == nil {
		return nil, fmt.Errorf("global informer manager is not initialized")
	}

	items, err := manager.ListFromCache(resource, namespace)
	if err == nil {
		return items, nil
	}

	return manager.ListLive(ctx, resource, namespace)
}
