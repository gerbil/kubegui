package crd

import (
	"reflect"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestBuildCategoriesFromCRDs_GroupsSortsDedupesAndSkipsInvalidDefinitions(t *testing.T) {
	crds := []unstructured.Unstructured{
		newCRD("abc.cilium.io", "cilium.io", "abc", "Abc"),
		newCRD("abc2.cilium.io", "cilium.io", "abc2", "AbcTwo"),
		newCRD("abc.cilium.io", "cilium.io", "abc", "Abc"), // duplicate must be deduped
		newCRD("widgets.example.com", "example.com", "widgets", "Widget"),
		newCRD("invalid.example.com", "example.com", "", "Ignored"),
	}

	groups, uiMap := buildCategoriesFromCRDs(crds)

	wantGroups := []CategoryGroup{
		{Category: "cilium.io", Items: []Item{{Name: "abc", Label: "Abc"}, {Name: "abc2", Label: "AbcTwo"}}},
		{Category: "example.com", Items: []Item{{Name: "widgets", Label: "Widget"}}},
	}
	if !reflect.DeepEqual(groups, wantGroups) {
		t.Fatalf("unexpected groups\nwant: %#v\ngot:  %#v", wantGroups, groups)
	}

	wantMap := map[string]string{
		"cilium.io":   "Abc, AbcTwo",
		"example.com": "Widget",
	}
	if !reflect.DeepEqual(uiMap, wantMap) {
		t.Fatalf("unexpected uiMap\nwant: %#v\ngot:  %#v", wantMap, uiMap)
	}
}

func newCRD(name, group, plural, kind string) unstructured.Unstructured {
	return unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "apiextensions.k8s.io/v1",
		"kind":       "CustomResourceDefinition",
		"metadata": map[string]any{
			"name": name,
		},
		"spec": map[string]any{
			"group": group,
			"names": map[string]any{
				"plural": plural,
				"kind":   kind,
			},
		},
	}}
}
