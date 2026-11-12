package services

import "testing"

func TestParseArgoApplicationYAML(t *testing.T) {
	u, err := parseArgoApplicationYAML("apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: app\nspec:\n  project: default\n")
	if err != nil {
		t.Fatal(err)
	}
	if u.GetNamespace() != argoDefaultNamespace {
		t.Fatalf("expected default namespace, got %q", u.GetNamespace())
	}

	bad := map[string]string{
		"empty":      "",
		"wrong kind": "apiVersion: argoproj.io/v1alpha1\nkind: Pod\nmetadata:\n  name: a\n",
		"wrong api":  "apiVersion: v1\nkind: Application\nmetadata:\n  name: a\n",
		"no name":    "apiVersion: argoproj.io/v1alpha1\nkind: Application\n",
		"multi doc":  "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: a\n---\nkind: Application\n",
	}
	for name, doc := range bad {
		if _, err := parseArgoApplicationYAML(doc); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}
