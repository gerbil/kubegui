package crd

import (
	"context"
	"sort"
	"strings"

	"kubegui/internal/kubeclients"
	"kubegui/internal/logger"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type Item struct {
	Name  string
	Label string
}

type CategoryGroup struct {
	Category string
	Items    []Item
}

// GetMenuList returns CRDs grouped by API category and a UI-friendly map.
// Example map entry: "cilium.io" -> "CiliumClusterwideNetworkPolicy, CiliumNetworkPolicy".
func GetMenuList() ([]CategoryGroup, map[string]string, error) {
	dyn, err := kubeclients.GetDynamicClient()
	if err != nil {
		logger.Logger.Error("error in getting DynamicClient", "err", err)
		return nil, nil, err
	}

	crds, err := dyn.Resource(schema.GroupVersionResource{
		Group:    "apiextensions.k8s.io",
		Version:  "v1",
		Resource: "customresourcedefinitions",
	}).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		logger.Logger.Error("error listing CustomResourceDefinitions", "err", err)
		return nil, nil, err
	}

	sortedCRDs, uiMap := buildCategoriesFromCRDs(crds.Items)
	return sortedCRDs, uiMap, nil
}

func buildCategoriesFromCRDs(crds []unstructured.Unstructured) ([]CategoryGroup, map[string]string) {
	resourcesByCategory := make(map[string]map[string]Item)

	for _, crd := range crds {
		category, _, _ := unstructured.NestedString(crd.Object, "spec", "group")
		plural, _, _ := unstructured.NestedString(crd.Object, "spec", "names", "plural")
		kind, _, _ := unstructured.NestedString(crd.Object, "spec", "names", "kind")
		category = strings.TrimSpace(category)
		plural = strings.TrimSpace(plural)
		if category == "" || plural == "" {
			continue
		}

		if _, ok := resourcesByCategory[category]; !ok {
			resourcesByCategory[category] = make(map[string]Item)
		}

		label := strings.TrimSpace(kind)
		if label == "" {
			label = fallbackLabel(plural)
		}
		resourcesByCategory[category][plural] = Item{
			Name:  plural,
			Label: label,
		}
	}

	categories := make([]string, 0, len(resourcesByCategory))
	for category := range resourcesByCategory {
		categories = append(categories, category)
	}
	sort.Strings(categories)

	sortedCRDs := make([]CategoryGroup, 0, len(categories))
	uiMap := make(map[string]string, len(categories))

	for _, category := range categories {
		set := resourcesByCategory[category]
		items := make([]Item, 0, len(set))
		for _, item := range set {
			items = append(items, item)
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].Label == items[j].Label {
				return items[i].Name < items[j].Name
			}
			return items[i].Label < items[j].Label
		})

		sortedCRDs = append(sortedCRDs, CategoryGroup{
			Category: category,
			Items:    items,
		})

		labels := make([]string, 0, len(items))
		for _, item := range items {
			labels = append(labels, item.Label)
		}
		uiMap[category] = strings.Join(labels, ", ")
	}

	return sortedCRDs, uiMap
}

func fallbackLabel(resourceName string) string {
	parts := strings.FieldsFunc(resourceName, func(r rune) bool {
		return r == '-' || r == '_' || r == '.' || r == '/'
	})
	if len(parts) == 0 {
		return resourceName
	}
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, "")
}
