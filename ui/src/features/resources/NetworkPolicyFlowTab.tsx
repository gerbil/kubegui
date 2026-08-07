import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  MarkerType,
  BackgroundVariant,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NPSpec {
  podSelector?: { matchLabels?: Record<string, string>; matchExpressions?: Array<{ key: string; operator: string }> }
  endpointSelector?: { matchLabels?: Record<string, string>; matchExpressions?: Array<{ key: string; operator: string }> }
  policyTypes?: string[]
  ingress?: IngressRule[]
  egress?: EgressRule[]
  ingressRules?: IngressRule[]
  egressRules?: EgressRule[]
}

interface IngressRule {
  from?: NetworkPolicyPeer[]
  ports?: PolicyPort[]
  fromEndpoints?: Array<Record<string, unknown>>
  fromEntities?: string[]
  fromCIDR?: string[]
  fromCIDRSet?: Array<{ cidr: string; except?: string[] }>
  toPorts?: Array<{ ports?: PolicyPort[] }>
}

interface EgressRule {
  to?: NetworkPolicyPeer[]
  ports?: PolicyPort[]
  toEndpoints?: Array<Record<string, unknown>>
  toEntities?: string[]
  toCIDR?: string[]
  toCIDRSet?: Array<{ cidr: string; except?: string[] }>
  toFQDNs?: Array<{ matchName?: string; matchPattern?: string }>
  toServices?: Array<{ k8sService?: { serviceName?: string; namespace?: string }; k8sServiceSelector?: { selector?: Record<string, unknown>; namespace?: string } }>
  toPorts?: Array<{ ports?: PolicyPort[] }>
}

interface NetworkPolicyPeer {
  podSelector?: Record<string, unknown>
  namespaceSelector?: Record<string, unknown>
  ipBlock?: { cidr: string; except?: string[] }
}

interface PolicyPort {
  protocol?: string
  port?: string | number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelSelectorStr(sel: Record<string, unknown> | undefined): string {
  if (!sel) return ''
  const parts: string[] = []
  const ml = sel['matchLabels'] as Record<string, string> | undefined
  if (ml) {
    Object.entries(ml)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => parts.push(`${k}=${v}`))
  }
  const me = sel['matchExpressions'] as Array<{ key: string; operator: string }> | undefined
  if (me) me.forEach((e) => parts.push(`${e.key} ${e.operator}`))
  return parts.join(', ')
}

function formatSelectorForNode(label: string): string {
  // Prefer wrapping at selector separators instead of inside label values.
  return label.replace(/,\s+/g, ',\n')
}

function portsStr(ports?: PolicyPort[]): string {
  if (!ports?.length) return ''
  return ports
    .map((p) => {
      const proto = p.protocol ? `${p.protocol}/` : ''
      return p.port !== undefined ? `${proto}${p.port}` : ''
    })
    .filter(Boolean)
    .join(', ')
}

function rulePorts(rule: IngressRule | EgressRule): PolicyPort[] {
  if (rule.ports?.length) return rule.ports
  const ciliumPorts = (rule.toPorts ?? []).flatMap((entry) => entry.ports ?? [])
  return ciliumPorts
}

function peerLabel(peer: NetworkPolicyPeer): { label: string; type: string } {
  if (peer.podSelector !== undefined) {
    const sel = labelSelectorStr(peer.podSelector)
    return { label: sel ? `Pods: ${formatSelectorForNode(sel)}` : 'All Pods', type: 'pod' }
  }
  if (peer.namespaceSelector !== undefined) {
    const sel = labelSelectorStr(peer.namespaceSelector)
    return { label: sel ? `NS: ${formatSelectorForNode(sel)}` : 'All Namespaces', type: 'namespace' }
  }
  if (peer.ipBlock) {
    const exc = peer.ipBlock.except?.length ? ` (excl. ${peer.ipBlock.except.length})` : ''
    return { label: `${peer.ipBlock.cidr}${exc}`, type: 'ipblock' }
  }
  return { label: 'Peer', type: 'pod' }
}

function ciliumSelectorLabel(sel: Record<string, unknown>): { label: string; type: string } {
  const selectorText = labelSelectorStr(sel)
  return { label: selectorText ? `Endpoints: ${formatSelectorForNode(selectorText)}` : 'All Endpoints', type: 'pod' }
}

function ingressPeerLabels(rule: IngressRule): Array<{ label: string; type: string }> {
  const labels: Array<{ label: string; type: string }> = []
  ;(rule.from ?? []).forEach((peer) => labels.push(peerLabel(peer)))
  ;(rule.fromEndpoints ?? []).forEach((sel) => labels.push(ciliumSelectorLabel(sel)))
  ;(rule.fromEntities ?? []).forEach((entity) => labels.push({ label: `Entity: ${entity}`, type: 'entity' }))
  ;(rule.fromCIDR ?? []).forEach((cidr) => labels.push({ label: cidr, type: 'ipblock' }))
  ;(rule.fromCIDRSet ?? []).forEach((item) => {
    const exc = item.except?.length ? ` (excl. ${item.except.length})` : ''
    labels.push({ label: `${item.cidr}${exc}`, type: 'ipblock' })
  })
  return labels
}

function egressPeerLabels(rule: EgressRule): Array<{ label: string; type: string }> {
  const labels: Array<{ label: string; type: string }> = []
  ;(rule.to ?? []).forEach((peer) => labels.push(peerLabel(peer)))
  ;(rule.toEndpoints ?? []).forEach((sel) => labels.push(ciliumSelectorLabel(sel)))
  ;(rule.toEntities ?? []).forEach((entity) => labels.push({ label: `Entity: ${entity}`, type: 'entity' }))
  ;(rule.toCIDR ?? []).forEach((cidr) => labels.push({ label: cidr, type: 'ipblock' }))
  ;(rule.toCIDRSet ?? []).forEach((item) => {
    const exc = item.except?.length ? ` (excl. ${item.except.length})` : ''
    labels.push({ label: `${item.cidr}${exc}`, type: 'ipblock' })
  })
  ;(rule.toFQDNs ?? []).forEach((fqdn) => {
    const value = fqdn.matchName ?? fqdn.matchPattern
    if (value) labels.push({ label: `FQDN: ${value}`, type: 'fqdn' })
  })
  ;(rule.toServices ?? []).forEach((svc, idx) => {
    const serviceName = svc.k8sService?.serviceName
    const serviceNamespace = svc.k8sService?.namespace
    if (serviceName) {
      labels.push({ label: `Service: ${serviceNamespace ? `${serviceNamespace}/` : ''}${serviceName}`, type: 'service' })
      return
    }
    const selectorText = labelSelectorStr(svc.k8sServiceSelector?.selector)
    const selectorNamespace = svc.k8sServiceSelector?.namespace
    if (selectorText || selectorNamespace) {
      labels.push({ label: `Service Selector: ${selectorNamespace ? `${selectorNamespace} ` : ''}${selectorText}`.trim(), type: 'service' })
      return
    }
    labels.push({ label: `Service Target ${idx + 1}`, type: 'service' })
  })
  return labels
}

// ── Node colour by type ───────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  policy:    { bg: '#1e2d5a', border: '#6a7fc9', text: '#c5d0f5' },
  pod:       { bg: '#1a3328', border: '#34d399', text: '#6ee7b7' },
  namespace: { bg: '#2d1e4a', border: '#a78bfa', text: '#c4b5fd' },
  ipblock:   { bg: '#3b2a15', border: '#f59e0b', text: '#fcd34d' },
  entity:    { bg: '#103045', border: '#38bdf8', text: '#7dd3fc' },
  fqdn:      { bg: '#2e2a4e', border: '#818cf8', text: '#c7d2fe' },
  service:   { bg: '#3b1f2e', border: '#fb7185', text: '#fda4af' },
  all:       { bg: '#2a2a3a', border: '#64748b', text: '#94a3b8' },
}

function nodeStyle(type: string): React.CSSProperties {
  const c = NODE_COLORS[type] ?? NODE_COLORS.all
  return {
    background: c.bg,
    border: `1.5px solid ${c.border}`,
    color: c.text,
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 9,
    fontFamily: 'var(--font-modal, monospace)',
    maxWidth: 200,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'normal',
    overflowWrap: 'anywhere',
    lineHeight: 1.4,
    textAlign: 'center' as const,
  }
}

// ── Main builder ──────────────────────────────────────────────────────────────

function buildFlowGraph(full: Record<string, unknown>): { nodes: Node[]; edges: Edge[] } {
  const meta = full.metadata as Record<string, unknown> | undefined
  const name = (meta?.name as string | undefined) ?? 'NetworkPolicy'
  const spec = full.spec as NPSpec | undefined

  const nodes: Node[] = []
  const edges: Edge[] = []

  let policyLabel = name
  const policySelector = (spec?.podSelector ?? spec?.endpointSelector) as Record<string, unknown> | undefined
  if (policySelector) {
    const sel = labelSelectorStr(policySelector)
    if (sel) policyLabel = `${name}\n${formatSelectorForNode(sel)}`
  }

  nodes.push({
    id: 'policy',
    position: { x: 400, y: 220 },
    data: { label: policyLabel },
    style: nodeStyle('policy'),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  })

  const nodeSet = new Set<string>(['policy'])
  let edgeIdx = 0

  const addNode = (id: string, label: string, type: string, x: number, y: number) => {
    if (!nodeSet.has(id)) {
      nodeSet.add(id)
      nodes.push({
        id,
        position: { x, y },
        data: { label },
        style: nodeStyle(type),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })
    }
  }

  const addEdge = (src: string, tgt: string, label: string) => {
    edgeIdx++
    edges.push({
      id: `e${edgeIdx}`,
      source: src,
      target: tgt,
      label: label || undefined,
      labelStyle: { fontSize: 9, fill: '#94a3b8' },
      labelBgStyle: { fill: '#0f1629', fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6a7fc9' },
      style: { stroke: '#6a7fc9', strokeWidth: 1.5 },
      animated: false,
    })
  }

  // ── Ingress (left column) ────────────────────────────────────────────────
  const ingress = spec?.ingress ?? spec?.ingressRules ?? []
  let ingressIdx = 0

  ingress.forEach((rule, ri) => {
    const portLbl = portsStr(rulePorts(rule))
    const froms = ingressPeerLabels(rule)
    if (!froms?.length) {
      const id = `ingress-all-${ri}`
      const y = 60 + ingressIdx * 110
      addNode(id, 'All Sources', 'all', 50, y)
      addEdge(id, 'policy', portLbl)
      ingressIdx++
      return
    }
    froms.forEach((peer, pi) => {
      const { label, type } = peer
      const id = `ingress-${ri}-${pi}`
      const y = 60 + ingressIdx * 110
      addNode(id, label, type, 50, y)
      addEdge(id, 'policy', portLbl)
      ingressIdx++
    })
  })

  // ── Egress (right column) ────────────────────────────────────────────────
  const egress = spec?.egress ?? spec?.egressRules ?? []
  let egressIdx = 0

  egress.forEach((rule, ri) => {
    const portLbl = portsStr(rulePorts(rule))
    const tos = egressPeerLabels(rule)
    if (!tos?.length) {
      const id = `egress-all-${ri}`
      const y = 60 + egressIdx * 110
      addNode(id, 'All Destinations', 'all', 760, y)
      addEdge('policy', id, portLbl)
      egressIdx++
      return
    }
    tos.forEach((peer, pi) => {
      const { label, type } = peer
      const id = `egress-${ri}-${pi}`
      const y = 60 + egressIdx * 110
      addNode(id, label, type, 760, y)
      addEdge('policy', id, portLbl)
      egressIdx++
    })
  })

  return { nodes, edges }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NetworkPolicyFlowTab({ full }: { full: Record<string, unknown> | null }) {
  const { nodes, edges } = useMemo(() => {
    if (!full) return { nodes: [], edges: [] }
    return buildFlowGraph(full)
  }, [full])

  if (!full) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      </div>
    )
  }

  const policyTypes = ((full.spec as Record<string, unknown> | undefined)?.policyTypes as string[] | undefined) ?? []
  const spec = full.spec as Record<string, unknown> | undefined
  const hasIngress = policyTypes.includes('Ingress')
    || (spec?.ingress as unknown[])?.length > 0
    || (spec?.ingressRules as unknown[])?.length > 0
  const hasEgress  = policyTypes.includes('Egress')
    || (spec?.egress as unknown[])?.length > 0
    || (spec?.egressRules as unknown[])?.length > 0

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="netpol-flow-tab">
      {/* Legend bar */}
      <div className="shrink-0 flex items-center gap-4 px-5 py-2 border-b border-border/30 bg-accent/5 text-[10px] text-muted-foreground">
        <span className="font-semibold text-foreground/60">Network Flow</span>
        {hasIngress && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Ingress</span>}
        {hasEgress  && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />Egress</span>}
        <span className="ml-auto opacity-50">drag · scroll to zoom</span>
      </div>

      {/* Flow canvas */}
      <div className="flex-1 min-h-0" style={{ background: '#0b1124' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2d5a" />
          <Controls showInteractive={false} style={{ background: '#1e2d5a', border: '1px solid #354065', borderRadius: 6 }} />
        </ReactFlow>
      </div>
    </div>
  )
}

