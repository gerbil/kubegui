// Package networkpolicies provides graph building helpers for NetworkPolicy
// resources so the frontend can render a react-flow topology view.
package networkpolicies

import (
	"fmt"
	"sort"
	"strings"
)

// GraphNode is a single node in the react-flow network policy graph.
type GraphNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Type: "policy" | "pod" | "namespace" | "ipblock" | "all"
	Type string `json:"type"`
}

// GraphEdge connects two nodes.
type GraphEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	// Label carries port/protocol info when present.
	Label string `json:"label,omitempty"`
}

// Graph is the full react-flow graph payload returned to the frontend.
type Graph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// BuildGraph constructs a react-flow graph from a raw NetworkPolicy
// unstructured map. It is a pure function with no external dependencies so it
// is easy to unit-test.
func BuildGraph(raw map[string]any) Graph {
	g := Graph{
		Nodes: []GraphNode{},
		Edges: []GraphEdge{},
	}

	name := extractName(raw)
	spec, _ := raw["spec"].(map[string]any)
	if spec == nil {
		g.Nodes = append(g.Nodes, GraphNode{ID: "policy", Label: name, Type: "policy"})
		return g
	}

	// Build policy (center) node label with podSelector info.
	policyLabel := name
	if podSel, ok := spec["podSelector"].(map[string]any); ok {
		if sel := labelSelectorString(podSel); sel != "" {
			policyLabel = fmt.Sprintf("%s\n%s", name, sel)
		}
	}
	g.Nodes = append(g.Nodes, GraphNode{ID: "policy", Label: policyLabel, Type: "policy"})

	nodeSet := map[string]bool{"policy": true}
	edgeIdx := 0

	addNode := func(n GraphNode) {
		if !nodeSet[n.ID] {
			nodeSet[n.ID] = true
			g.Nodes = append(g.Nodes, n)
		}
	}
	nextEdgeID := func() string {
		edgeIdx++
		return fmt.Sprintf("e%d", edgeIdx)
	}

	// ── Ingress rules: peer → policy ────────────────────────────────────────
	if ingress, ok := spec["ingress"].([]any); ok {
		for i, rule := range ingress {
			ruleMap, _ := rule.(map[string]any)
			if ruleMap == nil {
				continue
			}
			portsLbl := portsString(ruleMap["ports"])
			froms, _ := ruleMap["from"].([]any)
			if len(froms) == 0 {
				// Allow all sources.
				id := fmt.Sprintf("ingress-all-%d", i)
				addNode(GraphNode{ID: id, Label: "All Sources", Type: "all"})
				g.Edges = append(g.Edges, GraphEdge{ID: nextEdgeID(), Source: id, Target: "policy", Label: portsLbl})
				continue
			}
			for j, peer := range froms {
				peerMap, _ := peer.(map[string]any)
				if peerMap == nil {
					continue
				}
				node, ok := peerToNode(peerMap, fmt.Sprintf("ingress-%d-%d", i, j))
				if !ok {
					continue
				}
				addNode(node)
				g.Edges = append(g.Edges, GraphEdge{ID: nextEdgeID(), Source: node.ID, Target: "policy", Label: portsLbl})
			}
		}
	}

	// ── Egress rules: policy → peer ─────────────────────────────────────────
	if egress, ok := spec["egress"].([]any); ok {
		for i, rule := range egress {
			ruleMap, _ := rule.(map[string]any)
			if ruleMap == nil {
				continue
			}
			portsLbl := portsString(ruleMap["ports"])
			tos, _ := ruleMap["to"].([]any)
			if len(tos) == 0 {
				id := fmt.Sprintf("egress-all-%d", i)
				addNode(GraphNode{ID: id, Label: "All Destinations", Type: "all"})
				g.Edges = append(g.Edges, GraphEdge{ID: nextEdgeID(), Source: "policy", Target: id, Label: portsLbl})
				continue
			}
			for j, peer := range tos {
				peerMap, _ := peer.(map[string]any)
				if peerMap == nil {
					continue
				}
				node, ok := peerToNode(peerMap, fmt.Sprintf("egress-%d-%d", i, j))
				if !ok {
					continue
				}
				addNode(node)
				g.Edges = append(g.Edges, GraphEdge{ID: nextEdgeID(), Source: "policy", Target: node.ID, Label: portsLbl})
			}
		}
	}

	return g
}

// ── helpers ──────────────────────────────────────────────────────────────────

func extractName(raw map[string]any) string {
	meta, _ := raw["metadata"].(map[string]any)
	if meta != nil {
		if n, _ := meta["name"].(string); n != "" {
			return n
		}
	}
	return "NetworkPolicy"
}

func peerToNode(peer map[string]any, prefix string) (GraphNode, bool) {
	if pod, ok := peer["podSelector"].(map[string]any); ok {
		sel := labelSelectorString(pod)
		label := "All Pods"
		if sel != "" {
			label = fmt.Sprintf("Pods: %s", sel)
		}
		return GraphNode{ID: prefix + "-pod", Label: label, Type: "pod"}, true
	}
	if ns, ok := peer["namespaceSelector"].(map[string]any); ok {
		sel := labelSelectorString(ns)
		label := "All Namespaces"
		if sel != "" {
			label = fmt.Sprintf("NS: %s", sel)
		}
		return GraphNode{ID: prefix + "-ns", Label: label, Type: "namespace"}, true
	}
	if ip, ok := peer["ipBlock"].(map[string]any); ok {
		cidr, _ := ip["cidr"].(string)
		label := cidr
		if excepts, ok := ip["except"].([]any); ok && len(excepts) > 0 {
			label = fmt.Sprintf("%s (excl. %d)", cidr, len(excepts))
		}
		return GraphNode{ID: prefix + "-ip", Label: label, Type: "ipblock"}, true
	}
	return GraphNode{}, false
}

func labelSelectorString(sel map[string]any) string {
	parts := []string{}
	if ml, ok := sel["matchLabels"].(map[string]any); ok {
		keys := make([]string, 0, len(ml))
		for k := range ml {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("%s=%v", k, ml[k]))
		}
	}
	if me, ok := sel["matchExpressions"].([]any); ok {
		for _, expr := range me {
			exprMap, _ := expr.(map[string]any)
			if exprMap == nil {
				continue
			}
			key, _ := exprMap["key"].(string)
			op, _ := exprMap["operator"].(string)
			if key != "" {
				parts = append(parts, fmt.Sprintf("%s %s", key, op))
			}
		}
	}
	return strings.Join(parts, ", ")
}

func portsString(raw any) string {
	ports, ok := raw.([]any)
	if !ok || len(ports) == 0 {
		return ""
	}
	parts := []string{}
	for _, p := range ports {
		pm, _ := p.(map[string]any)
		if pm == nil {
			continue
		}
		proto := ""
		if pr, ok := pm["protocol"].(string); ok && pr != "" {
			proto = pr + "/"
		}
		port := ""
		switch v := pm["port"].(type) {
		case string:
			port = v
		case float64:
			port = fmt.Sprintf("%d", int(v))
		case int64:
			port = fmt.Sprintf("%d", v)
		case int:
			port = fmt.Sprintf("%d", v)
		}
		if port != "" {
			parts = append(parts, proto+port)
		}
	}
	return strings.Join(parts, ", ")
}

