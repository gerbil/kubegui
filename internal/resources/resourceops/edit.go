package resourceops

import (
	"context"
	"fmt"

	"kubegui/internal/resources/informers"
)

// Edit updates a resource object via the manager's dynamic client.
func Edit(ctx context.Context, manager *informers.GlobalInformers, resource, namespace, name string, object map[string]any) (map[string]any, error) {
	if manager == nil {
		return nil, fmt.Errorf("global informer manager is not initialized")
	}
	return manager.Edit(ctx, resource, namespace, name, object)
}
