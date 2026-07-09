package informers

import (
  "strings"

  apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
  metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
  "k8s.io/apimachinery/pkg/runtime/schema"
)

func addCRDToSet(out map[string]struct{}, crd apiextensionsv1.CustomResourceDefinition) {
  for _, version := range crd.Spec.Versions {
    if !version.Served {
      continue
    }

    key := resourceKey(
      crd.Spec.Group,
      version.Name,
      crd.Spec.Names.Plural,
    )

    out[key] = struct{}{}
  }
}

func shouldSkipAPIResource(	gv schema.GroupVersion,	apiResource metav1.APIResource,	crdOwned map[string]struct{}) bool {
  if strings.Contains(apiResource.Name, "/") {
    return true
  }

  if apiResource.Name == "" || apiResource.Kind == "" {
    return true
  }

  if !hasVerb(apiResource.Verbs, "list") {
    return true
  }

  if gv.Group == "apiextensions.k8s.io" && apiResource.Name == "customresourcedefinitions" {
    return true
  }

  key := resourceKey(gv.Group, gv.Version, apiResource.Name)

  _, isCRDBacked := crdOwned[key]
  return isCRDBacked
}

func resourceKey(group, version, resource string) string {
  return group + "/" + version + "/" + resource
}

func hasVerb(verbs []string, want string) bool {
  for _, verb := range verbs {
    if verb == want {
      return true
    }
  }

  return false
}