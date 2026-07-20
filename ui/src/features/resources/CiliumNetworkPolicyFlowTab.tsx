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

// ── Cilium types ───────────────────────────────────────────────────────────────

interface CiliumEndpointSelector {
  matchLabels?: Record<string, string>
  matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>
}

interface CiliumCIDRSet {
  cidr: string
  except?: string[]
}

interface CiliumPortProtocol {
  port?: string | number
  protocol?: string
  endPort?: number
}

interface CiliumPortRule {
  ports?: CiliumPortProtocol[]
}

interface CiliumFQDN {
  matchName?: string
  matchPattern?: string
}

interface CiliumService {
  k8sService?: { serviceName?: string; namespace?: string }
  k8sServiceSelector?: { selector?: CiliumEndpointSelector; namespace?: string }
}

interface CiliumIngressRule {
  fromEndpoints?: CiliumEndpointSelector[]
  fromCIDR?: string[]
  fromCIDRSet?: CiliumCIDRSet[]
  fromEntities?: string[]
  fromRequires?: CiliumEndpointSelector[]
  fromGroups?: unknown[]
  toPorts?: CiliumPortRule[]
}

interface CiliumEgressRule {
  toEndpoints?: CiliumEndpointSelector[]
  toCIDR?: string[]
  toCIDRSet?: CiliumCIDRSet[]
  toEntities?: string[]
  toRequires?: CiliumEndpointSelector[]
  toServices?: CiliumService[]
  toFQDNs?: CiliumFQDN[]
  toGroups?: unknown[]
  toPorts?: CiliumPortRule[]
}

interface CiliumSpec {
  endpointSelector?: CiliumEndpointSelector
  nodeSelector?: CiliumEndpointSelector
  ingress?: CiliumIngressRule[]
  ingressDeny?: CiliumIngressRule[]
  egress?: CiliumEgressRule[]
  egressDeny?: CiliumEgressRule[]
  enableDefaultDeny?: { ingress?: boolean; egress?: boolean }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Insert zero-width spaces after natural break chars so text wraps at sensible spots */
function softBreak(text: string): string {
  return text.replace(/([./=\-_,])/g, '$1\u200B')
}

function selectorStr(sel: CiliumEndpointSelector | undefined): string {
  if (!sel) return ''
  const parts: string[] = []
  if (sel.matchLabels) {
    Object.entries(sel.matchLabels)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => parts.push(`${k}=${v}`))
  }
  if (sel.matchExpressions) {
    sel.matchExpressions.forEach((e) => parts.push(`${e.key} ${e.operator}`))
  }
  return parts.join(', ')
}

function portsFromRule(rule: CiliumPortRule[]): string {
  const ports: string[] = []
  for (const pr of rule) {
    for (const p of pr.ports ?? []) {
      const proto = p.protocol ? `${p.protocol}/` : ''
      if (p.port !== undefined) {
        const endPart = p.endPort ? `-${p.endPort}` : ''
        ports.push(`${proto}${p.port}${endPart}`)
      }
    }
  }
  return ports.join(', ')
}

// ── Node colour by type ────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  policy:    { bg: '#1e2d5a', border: '#6a7fc9', text: '#c5d0f5' },
  endpoint:  { bg: '#1a3328', border: '#34d399', text: '#6ee7b7' },
  cidr:      { bg: '#3b2a15', border: '#f59e0b', text: '#fcd34d' },
  entity:    { bg: '#2d1e4a', border: '#a78bfa', text: '#c4b5fd' },
  fqdn:      { bg: '#1a2a3a', border: '#38bdf8', text: '#7dd3fc' },
  service:   { bg: '#2a1f3a', border: '#e879f9', text: '#f0abfc' },
  all:       { bg: '#2a2a3a', border: '#64748b', text: '#94a3b8' },
  deny:      { bg: '#3a1a1a', border: '#f87171', text: '#fca5a5' },
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
    width: 190,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    overflowWrap: 'break-word' as const,
    lineHeight: 1.4,
    textAlign: 'center' as const,
  }
}

// ── Graph builder ──────────────────────────────────────────────────────────────

function buildCiliumFlowGraph(full: Record<string, unknown>): { nodes: Node[]; edges: Edge[] } {
  const meta = full.metadata as Record<string, unknown> | undefined
  const name = (meta?.name as string | undefined) ?? 'CiliumNetworkPolicy'
  const spec = full.spec as CiliumSpec | undefined

  const nodes: Node[] = []
  const edges: Edge[] = []
  const nodeSet = new Set<string>()
  let edgeIdx = 0

  // ── Center: policy / endpoint selector ──────────────────────────────────────
  const epSel = spec?.endpointSelector ?? spec?.nodeSelector
  const epStr = selectorStr(epSel)
  const centerLabel = epStr ? `${name}\n${epStr}` : name

  nodes.push({
    id: 'policy',
    position: { x: 400, y: 220 },
    data: { label: softBreak(centerLabel) },
    style: nodeStyle('policy'),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  })
  nodeSet.add('policy')

  const addNode = (id: string, label: string, type: string, x: number, y: number) => {
    if (!nodeSet.has(id)) {
      nodeSet.add(id)
      nodes.push({
        id,
        position: { x, y },
        data: { label: softBreak(label) },
        style: nodeStyle(type),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })
    }
  }

  const addEdge = (src: string, tgt: string, label: string, isDeny = false) => {
    edgeIdx++
    const color = isDeny ? '#f87171' : '#6a7fc9'
    edges.push({
      id: `e${edgeIdx}`,
      source: src,
      target: tgt,
      label: label || undefined,
      labelStyle: { fontSize: 9, fill: '#94a3b8' },
      labelBgStyle: { fill: '#0f1629', fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: isDeny ? '4 2' : undefined },
      animated: false,
    })
  }

  let ingressIdx = 0
  let egressIdx  = 0

  // ── Ingress rules ────────────────────────────────────────────────────────────
  const processIngress = (rules: CiliumIngressRule[], isDeny: boolean) => {
    rules.forEach((rule, ri) => {
      const portLbl = portsFromRule(rule.toPorts ?? [])
      const prefix = isDeny ? `deny-ingress-${ri}` : `ingress-${ri}`
      let hadPeers = false

      rule.fromEndpoints?.forEach((sel, pi) => {
        const s = selectorStr(sel)
        const id = `${prefix}-ep-${pi}`
        addNode(id, s ? `EP: ${s}` : 'All Endpoints', isDeny ? 'deny' : 'endpoint', 50, 60 + ingressIdx * 90)
        addEdge(id, 'policy', portLbl, isDeny)
        ingressIdx++; hadPeers = true
      })

      rule.fromCIDR?.forEach((cidr, ci) => {
        const id = `${prefix}-cidr-${ci}`
        addNode(id, cidr, isDeny ? 'deny' : 'cidr', 50, 60 + ingressIdx * 90)
        addEdge(id, 'policy', portLbl, isDeny)
        ingressIdx++; hadPeers = true
      })

      rule.fromCIDRSet?.forEach((cs, ci) => {
        const exc = cs.except?.length ? ` (-${cs.except.length})` : ''
        const id = `${prefix}-cidrset-${ci}`
        addNode(id, `${cs.cidr}${exc}`, isDeny ? 'deny' : 'cidr', 50, 60 + ingressIdx * 90)
        addEdge(id, 'policy', portLbl, isDeny)
        ingressIdx++; hadPeers = true
      })

      rule.fromEntities?.forEach((ent, ei) => {
        const id = `${prefix}-ent-${ei}`
        addNode(id, `entity: ${ent}`, isDeny ? 'deny' : 'entity', 50, 60 + ingressIdx * 90)
        addEdge(id, 'policy', portLbl, isDeny)
        ingressIdx++; hadPeers = true
      })

      rule.fromRequires?.forEach((sel, ri2) => {
        const s = selectorStr(sel)
        const id = `${prefix}-req-${ri2}`
        addNode(id, s ? `Requires: ${s}` : 'Requires all', isDeny ? 'deny' : 'endpoint', 50, 60 + ingressIdx * 90)
        addEdge(id, 'policy', portLbl, isDeny)
        ingressIdx++; hadPeers = true
      })

      if (!hadPeers) {
        const id = `${prefix}-all`
        addNode(id, isDeny ? '⛔ All Sources' : 'All Sources', isDeny ? 'deny' : 'all', 50, 60 + ingressIdx * 90)
        addEdge(id, 'policy', portLbl, isDeny)
        ingressIdx++
      }
    })
  }

  // ── Egress rules ─────────────────────────────────────────────────────────────
  const processEgress = (rules: CiliumEgressRule[], isDeny: boolean) => {
    rules.forEach((rule, ri) => {
      const portLbl = portsFromRule(rule.toPorts ?? [])
      const prefix = isDeny ? `deny-egress-${ri}` : `egress-${ri}`
      let hadPeers = false

      rule.toEndpoints?.forEach((sel, pi) => {
        const s = selectorStr(sel)
        const id = `${prefix}-ep-${pi}`
        addNode(id, s ? `EP: ${s}` : 'All Endpoints', isDeny ? 'deny' : 'endpoint', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++; hadPeers = true
      })

      rule.toCIDR?.forEach((cidr, ci) => {
        const id = `${prefix}-cidr-${ci}`
        addNode(id, cidr, isDeny ? 'deny' : 'cidr', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++; hadPeers = true
      })

      rule.toCIDRSet?.forEach((cs, ci) => {
        const exc = cs.except?.length ? ` (-${cs.except.length})` : ''
        const id = `${prefix}-cidrset-${ci}`
        addNode(id, `${cs.cidr}${exc}`, isDeny ? 'deny' : 'cidr', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++; hadPeers = true
      })

      rule.toEntities?.forEach((ent, ei) => {
        const id = `${prefix}-ent-${ei}`
        addNode(id, `entity: ${ent}`, isDeny ? 'deny' : 'entity', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++; hadPeers = true
      })

      rule.toFQDNs?.forEach((fqdn, fi) => {
        const label = fqdn.matchName ? `FQDN: ${fqdn.matchName}` : fqdn.matchPattern ? `FQDN: ${fqdn.matchPattern}` : 'FQDN'
        const id = `${prefix}-fqdn-${fi}`
        addNode(id, label, isDeny ? 'deny' : 'fqdn', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++; hadPeers = true
      })

      rule.toServices?.forEach((svc, si) => {
        const k = svc.k8sService
        const label = k ? `svc: ${k.namespace ? `${k.namespace}/` : ''}${k.serviceName ?? '*'}` : 'Service'
        const id = `${prefix}-svc-${si}`
        addNode(id, label, isDeny ? 'deny' : 'service', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++; hadPeers = true
      })

      rule.toRequires?.forEach((sel, ri2) => {
        const s = selectorStr(sel)
        const id = `${prefix}-req-${ri2}`
        addNode(id, s ? `Requires: ${s}` : 'Requires all', isDeny ? 'deny' : 'endpoint', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++; hadPeers = true
      })

      if (!hadPeers) {
        const id = `${prefix}-all`
        addNode(id, isDeny ? '⛔ All Destinations' : 'All Destinations', isDeny ? 'deny' : 'all', 760, 60 + egressIdx * 90)
        addEdge('policy', id, portLbl, isDeny)
        egressIdx++
      }
    })
  }

  processIngress(spec?.ingress ?? [], false)
  processIngress(spec?.ingressDeny ?? [], true)
  processEgress(spec?.egress ?? [], false)
  processEgress(spec?.egressDeny ?? [], true)

  return { nodes, edges }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CiliumNetworkPolicyFlowTab({ full }: { full: Record<string, unknown> | null }) {
  const { nodes, edges } = useMemo(() => {
    if (!full) return { nodes: [], edges: [] }
    return buildCiliumFlowGraph(full)
  }, [full])

  if (!full) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      </div>
    )
  }

  const spec = full.spec as CiliumSpec | undefined
  const hasIngress = (spec?.ingress?.length ?? 0) > 0
  const hasEgress  = (spec?.egress?.length ?? 0) > 0
  const hasDenyIngress = (spec?.ingressDeny?.length ?? 0) > 0
  const hasDenyEgress  = (spec?.egressDeny?.length ?? 0) > 0

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="cilium-netpol-flow-tab">
      {/* Legend bar */}
      <div className="shrink-0 flex items-center gap-4 px-5 py-2 border-b border-border/30 bg-accent/5 text-[10px] text-muted-foreground">
        <span className="font-semibold text-foreground/60">Cilium Network Flow</span>
        {hasIngress      && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Ingress</span>}
        {hasEgress       && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />Egress</span>}
        {hasDenyIngress  && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Deny Ingress</span>}
        {hasDenyEgress   && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Deny Egress</span>}
        <span className="flex items-center gap-2 ml-2 text-[9px] opacity-60">
          <span className="flex items-center gap-1"><span style={{ background: NODE_COLORS.endpoint.border, borderRadius: 2, display: 'inline-block', width: 8, height: 8 }} />Endpoint</span>
          <span className="flex items-center gap-1"><span style={{ background: NODE_COLORS.cidr.border, borderRadius: 2, display: 'inline-block', width: 8, height: 8 }} />CIDR</span>
          <span className="flex items-center gap-1"><span style={{ background: NODE_COLORS.entity.border, borderRadius: 2, display: 'inline-block', width: 8, height: 8 }} />Entity</span>
          <span className="flex items-center gap-1"><span style={{ background: NODE_COLORS.fqdn.border, borderRadius: 2, display: 'inline-block', width: 8, height: 8 }} />FQDN</span>
          <span className="flex items-center gap-1"><span style={{ background: NODE_COLORS.service.border, borderRadius: 2, display: 'inline-block', width: 8, height: 8 }} />Service</span>
        </span>
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

