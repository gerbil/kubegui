package std

import (
	"context"
	"fmt"
	"strings"
	"time"

	"kubegui/internal/kubeclients"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

type ResourceRef struct {
	GVR        schema.GroupVersionResource
	Namespaced bool
}

func ResolveResource(ctx context.Context, resource string) (ResourceRef, error) {
	dc, err := kubeclients.GetDiscoveryClient()
	if err != nil {
		return ResourceRef{}, err
	}

	lists, err := dc.ServerPreferredResources()
	if err != nil && len(lists) == 0 {
		return ResourceRef{}, err
	}

	name := strings.TrimSpace(strings.ToLower(resource))
	for _, list := range lists {
		gv, parseErr := schema.ParseGroupVersion(list.GroupVersion)
		if parseErr != nil {
			continue
		}
		for _, apiResource := range list.APIResources {
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if strings.EqualFold(apiResource.Name, name) {
				return ResourceRef{
					GVR: schema.GroupVersionResource{
						Group:    gv.Group,
						Version:  gv.Version,
						Resource: apiResource.Name,
					},
					Namespaced: apiResource.Namespaced,
				}, nil
			}
		}
	}

	return ResourceRef{}, fmt.Errorf("unsupported resource: %s", resource)
}

func resourceInterface(ctx context.Context, resource, namespace string) (dynamic.ResourceInterface, error) {
	dyn, err := kubeclients.GetDynamicClient()
	if err != nil {
		return nil, err
	}
	ref, err := ResolveResource(ctx, resource)
	if err != nil {
		return nil, err
	}
	res := dyn.Resource(ref.GVR)
	ns := strings.TrimSpace(namespace)
	if ref.Namespaced && ns != "" && ns != "all" && ns != "_" {
		return res.Namespace(ns), nil
	}
	return res, nil
}

func ListResources(resource, namespace string) ([]map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	resIfc, err := resourceInterface(ctx, resource, namespace)
	if err != nil {
		return nil, err
	}
	list, err := resIfc.List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(list.Items))
	for _, item := range list.Items {
		result = append(result, item.Object)
	}
	return result, nil
}

func GetResource(resource, namespace, name string) (*unstructured.Unstructured, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	resIfc, err := resourceInterface(ctx, resource, namespace)
	if err != nil {
		return nil, err
	}
	return resIfc.Get(ctx, name, metav1.GetOptions{})
}

func DeleteResource(resource, namespace, name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	resIfc, err := resourceInterface(ctx, resource, namespace)
	if err != nil {
		return err
	}
	return resIfc.Delete(ctx, name, metav1.DeleteOptions{})
}

func UpdateResource(resource, namespace, name string, object map[string]any) (*unstructured.Unstructured, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	resIfc, err := resourceInterface(ctx, resource, namespace)
	if err != nil {
		return nil, err
	}
	existing, err := resIfc.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	meta, ok := object["metadata"].(map[string]any)
	if !ok || meta == nil {
		meta = map[string]any{}
		object["metadata"] = meta
	}
	meta["name"] = name
	if ns := strings.TrimSpace(namespace); ns != "" && ns != "_" && ns != "all" {
		meta["namespace"] = ns
	}
	meta["resourceVersion"] = existing.GetResourceVersion()
	obj := &unstructured.Unstructured{Object: object}
	return resIfc.Update(ctx, obj, metav1.UpdateOptions{})
}

func CreateResource(resource string, object map[string]any) (*unstructured.Unstructured, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	metaRaw, _ := object["metadata"].(map[string]any)
	namespace := ""
	if metaRaw != nil {
		namespace = strings.TrimSpace(fmt.Sprint(metaRaw["namespace"]))
	}
	resIfc, err := resourceInterface(ctx, resource, namespace)
	if err != nil {
		return nil, err
	}
	obj := &unstructured.Unstructured{Object: object}
	return resIfc.Create(ctx, obj, metav1.CreateOptions{})
}