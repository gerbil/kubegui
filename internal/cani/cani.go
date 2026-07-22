package cani

import (
  "context"
  "fmt"
  "log"
  "strings"

  "kubegui/internal/kubeclients"

  authv1 "k8s.io/api/authorization/v1"
  metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// --------------------------------------------------------------------------------------
// Public types
// --------------------------------------------------------------------------------------

type CanIResult struct {
  Group    string `json:"group"`
  Version  string `json:"version"`
  Resource string `json:"resource"`
  Verb     string `json:"verb"`
  Allowed  bool   `json:"allowed"`
  Reason   string `json:"reason,omitempty"`
}

// One row per resource: all verbs flattened into fields.
type CanIResourceRow struct {
  Group    string `json:"group"`
  Version  string `json:"version"`
  Resource string `json:"resource"`

  Get    bool `json:"get"`
  List   bool `json:"list"`
  Watch  bool `json:"watch"`
  Create bool `json:"create"`
  Update bool `json:"update"`
  Patch  bool `json:"patch"`
  Delete bool `json:"delete"`

  // Optional: verb-specific reasons
  ReasonGet    string `json:"reason_get,omitempty"`
  ReasonList   string `json:"reason_list,omitempty"`
  ReasonWatch  string `json:"reason_watch,omitempty"`
  ReasonCreate string `json:"reason_create,omitempty"`
  ReasonUpdate string `json:"reason_update,omitempty"`
  ReasonPatch  string `json:"reason_patch,omitempty"`
  ReasonDelete string `json:"reason_delete,omitempty"`
}

// --------------------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------------------

// Namespace used for SelfSubjectRulesReview (rules can be namespace-dependent)
const rulesNamespace = "kube-system"

// Interesting verbs to check
var interestingVerbs = []string{
  "get",
  "list",
  "watch",
  "create",
  "update",
  "patch",
  "delete",
}

// If you want to restrict to a subset of resources, fill this map.
// If empty, we consider all resources discovered.
var interestingResources = map[string]bool{}

var ignoredAPIGroups = map[string]bool{
  "metrics.k8s.io": true,
  // add more if needed
}

// coreK8sGroups — built-in Kubernetes API groups.
// Any resource whose group is NOT in this set is a CRD and will be skipped.
var coreK8sGroups = map[string]bool{
  "":                                    true, // core
  "apps":                                true,
  "batch":                               true,
  "autoscaling":                         true,
  "networking.k8s.io":                   true,
  "rbac.authorization.k8s.io":           true,
  "storage.k8s.io":                      true,
  "policy":                              true,
  "apiextensions.k8s.io":               true,
  "admissionregistration.k8s.io":        true,
  "authentication.k8s.io":              true,
  "authorization.k8s.io":               true,
  "certificates.k8s.io":                true,
  "coordination.k8s.io":                true,
  "discovery.k8s.io":                   true,
  "events.k8s.io":                      true,
  "node.k8s.io":                        true,
  "scheduling.k8s.io":                  true,
  "flowcontrol.apiserver.k8s.io":       true,
}

var ignoredCoreResources = map[string]bool{
  "componentstatuses": true,
  "podtemplates":      true,
  "bindings":          true,
}

// --------------------------------------------------------------------------------------
// Main entry
// --------------------------------------------------------------------------------------

// CollectPermissions is a drop-in: still returns flat (resource,verb) records.
func CollectPermissions(ns string) ([]CanIResult, error) {
  // 1) Get effective rules
  rules, err := getRules(ns)
  if err != nil {
    return nil, fmt.Errorf("SelfSubjectRulesReview failed: %w", err)
  }

  // 2) Discover resources
  resourceLists, err := getResources()
  if err != nil {
    // Often partial errors due to forbidden groups; operate with what we have
    log.Printf("discovery warning: %v", err)
  }

  // 3) Build permission matrix
  results := expandRulesOverResources(rules, resourceLists)

  return results, nil
}

// AggregateCanIResults turns flat CanIResult slice into one row per resource.
func AggregateCanIResults(results []CanIResult) []CanIResourceRow {
  type key struct {
    Group    string
    Version  string
    Resource string
  }

  rowsMap := make(map[key]*CanIResourceRow)

  for _, r := range results {
    k := key{
      Group:    r.Group,
      Version:  r.Version,
      Resource: r.Resource,
    }

    row, ok := rowsMap[k]
    if !ok {
      row = &CanIResourceRow{
        Group:    r.Group,
        Version:  r.Version,
        Resource: r.Resource,
      }
      rowsMap[k] = row
    }

    switch r.Verb {
    case "get":
      row.Get = r.Allowed
      row.ReasonGet = r.Reason
    case "list":
      row.List = r.Allowed
      row.ReasonList = r.Reason
    case "watch":
      row.Watch = r.Allowed
      row.ReasonWatch = r.Reason
    case "create":
      row.Create = r.Allowed
      row.ReasonCreate = r.Reason
    case "update":
      row.Update = r.Allowed
      row.ReasonUpdate = r.Reason
    case "patch":
      row.Patch = r.Allowed
      row.ReasonPatch = r.Reason
    case "delete":
      row.Delete = r.Allowed
      row.ReasonDelete = r.Reason
    }
  }

  out := make([]CanIResourceRow, 0, len(rowsMap))
  for _, row := range rowsMap {
    out = append(out, *row)
  }
  return out
}

// --------------------------------------------------------------------------------------
// Helpers: discovery + rules
// --------------------------------------------------------------------------------------
func getResources() (resourceLists []*metav1.APIResourceList, err error) {
  cs, err := kubeclients.GetClientset()
  if err != nil {
    return
  }

  resourceLists, err = cs.Discovery().ServerPreferredResources()
  if err != nil {
    return
  }

  // Populate interestingResources from all API groups if still empty.
  if len(interestingResources) == 0 {
    for _, rl := range resourceLists {
      for _, r := range rl.APIResources {
        // Skip subresources like "pods/status"
        if strings.Contains(r.Name, "/") {
          continue
        }
        interestingResources[r.Name] = true
      }
    }
  }

  return
}

func getRules(ns string) (rules []authv1.ResourceRule, err error) {
  if ns == "" {
    ns = rulesNamespace
  }

  cs, err := kubeclients.GetClientset()
  if err != nil {
    return
  }

  rr, err := cs.AuthorizationV1().SelfSubjectRulesReviews().Create(
    context.Background(),
    &authv1.SelfSubjectRulesReview{
      Spec: authv1.SelfSubjectRulesReviewSpec{
        Namespace: ns,
      },
    },
    metav1.CreateOptions{},
  )
  if err != nil {
    return
  }

  rules = rr.Status.ResourceRules
  return
}

// --------------------------------------------------------------------------------------
// Permission expansion (flat list)
// --------------------------------------------------------------------------------------
func expandRulesOverResources(rules []authv1.ResourceRule, resourceLists []*metav1.APIResourceList) []CanIResult {
  var results []CanIResult

  for _, rl := range resourceLists {
    gv := rl.GroupVersion
    var group, version string

    if strings.Contains(gv, "/") {
      parts := strings.SplitN(gv, "/", 2)
      group, version = parts[0], parts[1]
    } else {
      group = ""
      version = gv
    }

    if isIgnoredGroup(group) {
      continue
    }

    // Skip CRD (non-core) groups — only show built-in k8s resources
    if !coreK8sGroups[group] {
      continue
    }

    for _, r := range rl.APIResources {
      // Skip subresources like pods/status
      if strings.Contains(r.Name, "/") {
        continue
      }

      if !isInterestingResource(r.Name) {
        continue
      }

      for _, verb := range interestingVerbs {
        allowed, reason := allowedByRules(rules, group, r.Name, verb)

        results = append(results, CanIResult{
          Group:    group,
          Version:  version,
          Resource: r.Name,
          Verb:     verb,
          Allowed:  allowed,
          Reason:   reason,
        })
      }
    }
  }

  return results
}

func isInterestingResource(name string) bool {
  if ignoredCoreResources[name] {
    return false
  }
  if len(interestingResources) == 0 {
    return true // no filter configured
  }
  return interestingResources[name]
}

func isIgnoredGroup(group string) bool {
  return ignoredAPIGroups[group]
}

// --------------------------------------------------------------------------------------
// Matching logic
// --------------------------------------------------------------------------------------
func allowedByRules(rules []authv1.ResourceRule, group, resource, verb string) (bool, string) {
  for _, rule := range rules {
    if !matches(rule.Verbs, verb) {
      continue
    }
    if !matches(rule.APIGroups, group) {
      continue
    }
    if !matches(rule.Resources, resource) {
      continue
    }
    return true, "allowed by SelfSubjectRulesReview"
  }
  return false, "no matching rule"
}

func matches(xs []string, v string) bool {
  for _, x := range xs {
    if x == "*" || x == v {
      return true
    }
  }
  return false
}
