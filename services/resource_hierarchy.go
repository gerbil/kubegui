package services

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"kubegui/internal/kubeclients"
	"kubegui/internal/resources/std"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

// HierarchyNode describes owner/child relationships for a Kubernetes resource.
type HierarchyNode struct {
	UID        string           `json:"uid,omitempty"`
	Kind       string           `json:"kind"`
	Resource   string           `json:"resource"`
	Name       string           `json:"name"`
	Namespace  string           `json:"namespace,omitempty"`
	APIVersion string           `json:"apiVersion,omitempty"`
	Phase      string           `json:"phase,omitempty"`
	Children   []*HierarchyNode `json:"children,omitempty"`
}

type hierarchyDirectory struct {
	byUID    map[types.UID]*unstructured.Unstructured
	children map[types.UID][]*unstructured.Unstructured
	resource map[types.UID]string
}

func newHierarchyDirectory() *hierarchyDirectory {
	return &hierarchyDirectory{
		byUID:    make(map[types.UID]*unstructured.Unstructured),
		children: make(map[types.UID][]*unstructured.Unstructured),
		resource: make(map[types.UID]string),
	}
}

func (d *hierarchyDirectory) add(obj *unstructured.Unstructured, resource string) {
	if obj == nil {
		return
	}
	uid := obj.GetUID()
	if uid == "" {
		return
	}
	d.byUID[uid] = obj
	if resource != "" {
		d.resource[uid] = strings.ToLower(resource)
	}
	for _, owner := range obj.GetOwnerReferences() {
		d.children[owner.UID] = append(d.children[owner.UID], obj)
	}
}

func (d *hierarchyDirectory) resourceFor(uid types.UID) string {
	if uid == "" {
		return ""
	}
	return d.resource[uid]
}

func isListableResource(apiResource metav1.APIResource) bool {
	if strings.Contains(apiResource.Name, "/") {
		return false
	}
	for _, verb := range apiResource.Verbs {
		if verb == "list" {
			return true
		}
	}
	return false
}

func resolvePhase(obj *unstructured.Unstructured) string {
	if obj == nil {
		return ""
	}
	status, ok := obj.Object["status"].(map[string]any)
	if !ok || status == nil {
		return ""
	}
	phase, _ := status["phase"].(string)
	return strings.TrimSpace(phase)
}

func nodeFromObject(obj *unstructured.Unstructured, fallbackResource string) *HierarchyNode {
	if obj == nil {
		return nil
	}
	resource := fallbackResource
	if resource == "" {
		resource = strings.ToLower(obj.GetKind())
	}
	return &HierarchyNode{
		UID:        string(obj.GetUID()),
		Kind:       obj.GetKind(),
		Resource:   resource,
		Name:       obj.GetName(),
		Namespace:  obj.GetNamespace(),
		APIVersion: obj.GetAPIVersion(),
		Phase:      resolvePhase(obj),
	}
}

func (s *Backend) ResourceGetHierarchy(resource, namespace, name string) (*HierarchyNode, error) {
	resource = strings.TrimSpace(resource)
	name = strings.TrimSpace(name)
	namespace = trimUnderscore(strings.TrimSpace(namespace))
	if resource == "" || name == "" {
		return nil, fmt.Errorf("resource and name are required")
	}

	root, err := std.GetResource(resource, namespace, name)
	if err != nil {
		return nil, err
	}
	rootNode := nodeFromObject(root, resource)
	if rootNode == nil {
		return nil, fmt.Errorf("resource %s/%s not found", resource, name)
	}

	dyn, err := kubeclients.GetDynamicClient()
	if err != nil {
		return nil, err
	}
	disco, err := kubeclients.GetDiscoveryClient()
	if err != nil {
		return nil, err
	}

	resourceLists, err := disco.ServerPreferredResources()
	if err != nil && len(resourceLists) == 0 {
		return nil, err
	}

	dir := newHierarchyDirectory()
	dir.add(root, resource)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	for _, resourceList := range resourceLists {
		gv, parseErr := schema.ParseGroupVersion(resourceList.GroupVersion)
		if parseErr != nil {
			continue
		}

		for _, apiResource := range resourceList.APIResources {
			if !isListableResource(apiResource) {
				continue
			}
			gvr := gv.WithResource(apiResource.Name)

			var list *unstructured.UnstructuredList
			if apiResource.Namespaced && namespace != "" && namespace != "all" {
				list, err = dyn.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{})
			} else {
				list, err = dyn.Resource(gvr).List(ctx, metav1.ListOptions{})
			}
			if err != nil {
				continue
			}
			for i := range list.Items {
				item := list.Items[i]
				copyItem := item.DeepCopy()
				dir.add(copyItem, apiResource.Name)
			}
		}
	}

	visited := make(map[types.UID]struct{})
	var build func(node *HierarchyNode, obj *unstructured.Unstructured)
	build = func(node *HierarchyNode, obj *unstructured.Unstructured) {
		if node == nil || obj == nil {
			return
		}
		uid := obj.GetUID()
		if uid == "" {
			return
		}
		if _, seen := visited[uid]; seen {
			return
		}
		visited[uid] = struct{}{}

		children := dir.children[uid]
		sort.Slice(children, func(i, j int) bool {
			li := strings.ToLower(children[i].GetKind() + "/" + children[i].GetName())
			lj := strings.ToLower(children[j].GetKind() + "/" + children[j].GetName())
			return li < lj
		})

		node.Children = make([]*HierarchyNode, 0, len(children))
		for _, child := range children {
			childNode := nodeFromObject(child, dir.resourceFor(child.GetUID()))
			if childNode == nil {
				continue
			}
			node.Children = append(node.Children, childNode)
			build(childNode, child)
		}
	}

	build(rootNode, root)
	return rootNode, nil
}
