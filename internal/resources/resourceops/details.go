package resourceops

import (
	"context"
	"fmt"

	"kubegui/internal/resources/informers"
)

// Details fetches a single resource object using the manager's dynamic client.
func Details(ctx context.Context, manager *informers.GlobalInformers, resource, namespace, name string) (map[string]any, error) {
	if manager == nil {
		return nil, fmt.Errorf("global informer manager is not initialized")
	}
	return manager.GetDetails(ctx, resource, namespace, name)
}
