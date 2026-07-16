package networkpolicies

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// makeNP is a helper that builds a minimal raw NetworkPolicy map.
func makeNP(name string, spec map[string]any) map[string]any {
	return map[string]any{
		"apiVersion": "networking.k8s.io/v1",
		"kind":       "NetworkPolicy",
		"metadata": map[string]any{
			"name":      name,
			"namespace": "default",
		},
		"spec": spec,
	}
}

func TestBuildGraph_EmptySpec(t *testing.T) {
	raw := map[string]any{
		"metadata": map[string]any{"name": "empty-policy"},
		"spec":     nil,
	}
	g := BuildGraph(raw)

	require.Len(t, g.Nodes, 1)
	assert.Equal(t, "policy", g.Nodes[0].ID)
	assert.Equal(t, "policy", g.Nodes[0].Type)
	assert.Empty(t, g.Edges)
}

func TestBuildGraph_NoRules(t *testing.T) {
	raw := makeNP("no-rules", map[string]any{
		"podSelector": map[string]any{},
		"policyTypes": []any{"Ingress"},
	})
	g := BuildGraph(raw)

	require.Len(t, g.Nodes, 1, "only the policy node when no ingress/egress rules")
	assert.Equal(t, "policy", g.Nodes[0].ID)
	assert.Empty(t, g.Edges)
}

func TestBuildGraph_IngressAllowAll(t *testing.T) {
	raw := makeNP("allow-all", map[string]any{
		"podSelector": map[string]any{},
		"ingress":     []any{map[string]any{}}, // rule with no "from" = allow all
		"policyTypes": []any{"Ingress"},
	})
	g := BuildGraph(raw)

	require.Len(t, g.Nodes, 2)
	require.Len(t, g.Edges, 1)
	edge := g.Edges[0]
	assert.Equal(t, "policy", edge.Target)
	assert.NotEqual(t, "policy", edge.Source)

	// Source node should be the "All Sources" node
	var srcNode *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].ID == edge.Source {
			srcNode = &g.Nodes[i]
			break
		}
	}
	require.NotNil(t, srcNode)
	assert.Equal(t, "all", srcNode.Type)
	assert.Equal(t, "All Sources", srcNode.Label)
}

func TestBuildGraph_IngressPodSelector(t *testing.T) {
	raw := makeNP("pod-ingress", map[string]any{
		"podSelector": map[string]any{"matchLabels": map[string]any{"app": "backend"}},
		"ingress": []any{
			map[string]any{
				"from": []any{
					map[string]any{
						"podSelector": map[string]any{
							"matchLabels": map[string]any{"role": "frontend"},
						},
					},
				},
				"ports": []any{
					map[string]any{"protocol": "TCP", "port": float64(8080)},
				},
			},
		},
		"policyTypes": []any{"Ingress"},
	})
	g := BuildGraph(raw)

	require.Len(t, g.Nodes, 2)
	require.Len(t, g.Edges, 1)

	edge := g.Edges[0]
	assert.Equal(t, "policy", edge.Target)
	assert.Equal(t, "TCP/8080", edge.Label)

	var peerNode *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].ID != "policy" {
			peerNode = &g.Nodes[i]
		}
	}
	require.NotNil(t, peerNode)
	assert.Equal(t, "pod", peerNode.Type)
	assert.Contains(t, peerNode.Label, "role=frontend")
}

func TestBuildGraph_IngressNamespaceSelector(t *testing.T) {
	raw := makeNP("ns-ingress", map[string]any{
		"podSelector": map[string]any{},
		"ingress": []any{
			map[string]any{
				"from": []any{
					map[string]any{
						"namespaceSelector": map[string]any{
							"matchLabels": map[string]any{"env": "prod"},
						},
					},
				},
			},
		},
		"policyTypes": []any{"Ingress"},
	})
	g := BuildGraph(raw)

	require.Len(t, g.Nodes, 2)
	var nsNode *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].Type == "namespace" {
			nsNode = &g.Nodes[i]
		}
	}
	require.NotNil(t, nsNode)
	assert.Contains(t, nsNode.Label, "env=prod")
}

func TestBuildGraph_IngressIPBlock(t *testing.T) {
	raw := makeNP("ip-ingress", map[string]any{
		"podSelector": map[string]any{},
		"ingress": []any{
			map[string]any{
				"from": []any{
					map[string]any{
						"ipBlock": map[string]any{
							"cidr":   "10.0.0.0/8",
							"except": []any{"10.1.0.0/16"},
						},
					},
				},
			},
		},
		"policyTypes": []any{"Ingress"},
	})
	g := BuildGraph(raw)

	var ipNode *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].Type == "ipblock" {
			ipNode = &g.Nodes[i]
		}
	}
	require.NotNil(t, ipNode)
	assert.Contains(t, ipNode.Label, "10.0.0.0/8")
	assert.Contains(t, ipNode.Label, "excl. 1")
}

func TestBuildGraph_EgressAllowAll(t *testing.T) {
	raw := makeNP("egress-allow-all", map[string]any{
		"podSelector": map[string]any{},
		"egress":      []any{map[string]any{}}, // rule with no "to" = allow all
		"policyTypes": []any{"Egress"},
	})
	g := BuildGraph(raw)

	require.Len(t, g.Edges, 1)
	edge := g.Edges[0]
	assert.Equal(t, "policy", edge.Source)
	assert.NotEqual(t, "policy", edge.Target)

	var dstNode *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].ID == edge.Target {
			dstNode = &g.Nodes[i]
		}
	}
	require.NotNil(t, dstNode)
	assert.Equal(t, "all", dstNode.Type)
	assert.Equal(t, "All Destinations", dstNode.Label)
}

func TestBuildGraph_EgressPodSelector(t *testing.T) {
	raw := makeNP("egress-pod", map[string]any{
		"podSelector": map[string]any{},
		"egress": []any{
			map[string]any{
				"to": []any{
					map[string]any{
						"podSelector": map[string]any{
							"matchLabels": map[string]any{"role": "db"},
						},
					},
				},
				"ports": []any{
					map[string]any{"protocol": "TCP", "port": float64(5432)},
				},
			},
		},
		"policyTypes": []any{"Egress"},
	})
	g := BuildGraph(raw)

	require.Len(t, g.Edges, 1)
	edge := g.Edges[0]
	assert.Equal(t, "policy", edge.Source)
	assert.Equal(t, "TCP/5432", edge.Label)

	var peerNode *GraphNode
	for i := range g.Nodes {
		if g.Nodes[i].Type == "pod" {
			peerNode = &g.Nodes[i]
		}
	}
	require.NotNil(t, peerNode)
	assert.Contains(t, peerNode.Label, "role=db")
}

func TestBuildGraph_IngressAndEgress(t *testing.T) {
	raw := makeNP("both-directions", map[string]any{
		"podSelector": map[string]any{"matchLabels": map[string]any{"app": "api"}},
		"ingress": []any{
			map[string]any{
				"from": []any{
					map[string]any{"podSelector": map[string]any{"matchLabels": map[string]any{"role": "client"}}},
				},
				"ports": []any{map[string]any{"protocol": "TCP", "port": float64(443)}},
			},
		},
		"egress": []any{
			map[string]any{
				"to": []any{
					map[string]any{"namespaceSelector": map[string]any{"matchLabels": map[string]any{"tier": "data"}}},
				},
				"ports": []any{map[string]any{"port": float64(3306)}},
			},
		},
		"policyTypes": []any{"Ingress", "Egress"},
	})
	g := BuildGraph(raw)

	// policy + ingress peer + egress peer = 3
	assert.Len(t, g.Nodes, 3)
	// 1 ingress edge + 1 egress edge = 2
	assert.Len(t, g.Edges, 2)

	ingressEdge := g.Edges[0]
	assert.Equal(t, "policy", ingressEdge.Target)
	assert.Equal(t, "TCP/443", ingressEdge.Label)

	egressEdge := g.Edges[1]
	assert.Equal(t, "policy", egressEdge.Source)
	assert.Equal(t, "3306", egressEdge.Label)
}

func TestBuildGraph_MultiplePortsLabel(t *testing.T) {
	raw := makeNP("multi-port", map[string]any{
		"podSelector": map[string]any{},
		"ingress": []any{
			map[string]any{
				"from": []any{
					map[string]any{"podSelector": map[string]any{}},
				},
				"ports": []any{
					map[string]any{"protocol": "TCP", "port": float64(80)},
					map[string]any{"protocol": "TCP", "port": float64(443)},
				},
			},
		},
		"policyTypes": []any{"Ingress"},
	})
	g := BuildGraph(raw)

	require.Len(t, g.Edges, 1)
	assert.Equal(t, "TCP/80, TCP/443", g.Edges[0].Label)
}

func TestBuildGraph_PolicyLabelIncludesPodSelector(t *testing.T) {
	raw := makeNP("selector-label", map[string]any{
		"podSelector": map[string]any{
			"matchLabels": map[string]any{"app": "web", "version": "v2"},
		},
		"policyTypes": []any{"Ingress"},
	})
	g := BuildGraph(raw)

	require.NotEmpty(t, g.Nodes)
	policyNode := g.Nodes[0]
	assert.Equal(t, "policy", policyNode.ID)
	assert.Contains(t, policyNode.Label, "app=web")
	assert.Contains(t, policyNode.Label, "version=v2")
}

func TestLabelSelectorString_Empty(t *testing.T) {
	assert.Equal(t, "", labelSelectorString(map[string]any{}))
}

func TestLabelSelectorString_MatchLabels(t *testing.T) {
	s := labelSelectorString(map[string]any{
		"matchLabels": map[string]any{"env": "prod", "app": "backend"},
	})
	// Sorted output.
	assert.Equal(t, "app=backend, env=prod", s)
}

func TestPortsString_Empty(t *testing.T) {
	assert.Equal(t, "", portsString(nil))
	assert.Equal(t, "", portsString([]any{}))
}

func TestPortsString_Mixed(t *testing.T) {
	ports := []any{
		map[string]any{"protocol": "UDP", "port": float64(53)},
		map[string]any{"port": "http"},
	}
	assert.Equal(t, "UDP/53, http", portsString(ports))
}

