import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ResourceList } from '../../../bindings/kubegui/services/backend'

type RbacResourceType = 'roles' | 'clusterroles' | 'rolebindings' | 'clusterrolebindings'

type RoleRef = {
  kind?: string
  name?: string
}

type Subject = {
  kind?: string
  name?: string
  namespace?: string
}

type BindingRecord = {
  metadata?: { name?: string; namespace?: string }
  roleRef?: RoleRef
  subjects?: Subject[]
}

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  role: { bg: '#1e2d5a', border: '#6a7fc9', text: '#c5d0f5' },
  clusterrole: { bg: '#34265f', border: '#a78bfa', text: '#ddd6fe' },
  rolebinding: { bg: '#1a3328', border: '#34d399', text: '#6ee7b7' },
  clusterrolebinding: { bg: '#3a3218', border: '#f59e0b', text: '#fde68a' },
  subject: { bg: '#2a2a3a', border: '#64748b', text: '#cbd5e1' },
}

function nodeStyle(type: string): React.CSSProperties {
  const c = NODE_COLORS[type] ?? NODE_COLORS.subject
  return {
    background: c.bg,
    border: `1.5px solid ${c.border}`,
    color: c.text,
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 9,
    fontFamily: 'var(--font-modal, monospace)',
    maxWidth: 220,
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.4,
    textAlign: 'center' as const,
  }
}

function getMeta(full: Record<string, unknown> | null): { name: string; namespace: string } {
  const meta = (full?.metadata as Record<string, unknown> | undefined) ?? {}
  return {
    name: (meta.name as string | undefined) ?? 'unknown',
    namespace: (meta.namespace as string | undefined) ?? '',
  }
}

function normalizeBinding(raw: Record<string, unknown>): BindingRecord {
  return {
    metadata: raw.metadata as { name?: string; namespace?: string } | undefined,
    roleRef: raw.roleRef as RoleRef | undefined,
    subjects: raw.subjects as Subject[] | undefined,
  }
}

function subjectLabel(subject: Subject): string {
  const kind = subject.kind ?? 'Subject'
  if (kind === 'ServiceAccount') {
    const ns = subject.namespace ? `${subject.namespace}/` : ''
    return `${kind}\n${ns}${subject.name ?? 'unknown'}`
  }
  return `${kind}\n${subject.name ?? 'unknown'}`
}

function roleTargetLabel(binding: BindingRecord): { label: string; type: string } {
  const roleRef = binding.roleRef ?? {}
  const kind = roleRef.kind === 'ClusterRole' ? 'ClusterRole' : 'Role'
  const nodeType = roleRef.kind === 'ClusterRole' ? 'clusterrole' : 'role'
  return {
    label: `${kind}\n${roleRef.name ?? 'unknown'}`,
    type: nodeType,
  }
}

function buildBindingGraph(resourceType: RbacResourceType, full: Record<string, unknown>): { nodes: Node[]; edges: Edge[] } {
  const { name, namespace } = getMeta(full)
  const binding = normalizeBinding(full)
  const centerType = resourceType === 'clusterrolebindings' ? 'clusterrolebinding' : 'rolebinding'
  const centerLabel = `${resourceType === 'clusterrolebindings' ? 'ClusterRoleBinding' : 'RoleBinding'}\n${namespace ? `${namespace}/` : ''}${name}`

  const nodes: Node[] = [
    {
      id: 'binding',
      position: { x: 420, y: 220 },
      data: { label: centerLabel },
      style: nodeStyle(centerType),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    },
  ]

  const edges: Edge[] = []
  let edgeIdx = 0

  const target = roleTargetLabel(binding)
  nodes.push({
    id: 'target',
    position: { x: 740, y: 220 },
    data: { label: target.label },
    style: nodeStyle(target.type),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  })
  edges.push({
    id: `e${++edgeIdx}`,
    source: 'binding',
    target: 'target',
    label: 'roleRef',
    labelStyle: { fontSize: 9, fill: '#94a3b8' },
    labelBgStyle: { fill: '#0f1629', fillOpacity: 0.85 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#6a7fc9' },
    style: { stroke: '#6a7fc9', strokeWidth: 1.5 },
  })

  const subjects = binding.subjects ?? []
  subjects.forEach((subject, idx) => {
    const id = `subject-${idx}`
    nodes.push({
      id,
      position: { x: 70, y: 70 + idx * 110 },
      data: { label: subjectLabel(subject) },
      style: nodeStyle('subject'),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
    edges.push({
      id: `e${++edgeIdx}`,
      source: id,
      target: 'binding',
      label: 'subject',
      labelStyle: { fontSize: 9, fill: '#94a3b8' },
      labelBgStyle: { fill: '#0f1629', fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6a7fc9' },
      style: { stroke: '#6a7fc9', strokeWidth: 1.5 },
    })
  })

  return { nodes, edges }
}

function buildRoleGraph(
  resourceType: RbacResourceType,
  full: Record<string, unknown>,
  roleBindings: BindingRecord[],
  clusterRoleBindings: BindingRecord[],
): { nodes: Node[]; edges: Edge[]; relationCount: number } {
  const { name, namespace } = getMeta(full)
  const isClusterRole = resourceType === 'clusterroles'

  const title = isClusterRole ? `ClusterRole\n${name}` : `Role\n${namespace}/${name}`
  const centerType = isClusterRole ? 'clusterrole' : 'role'

  const nodes: Node[] = [
    {
      id: 'role',
      position: { x: 430, y: 220 },
      data: { label: title },
      style: nodeStyle(centerType),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    },
  ]

  const edges: Edge[] = []
  let edgeIdx = 0
  let relationCount = 0

  const addBindingNode = (binding: BindingRecord, type: 'rolebinding' | 'clusterrolebinding', x: number, y: number) => {
    const bName = binding.metadata?.name ?? 'unknown'
    const bNs = binding.metadata?.namespace
    const kindLabel = type === 'clusterrolebinding' ? 'ClusterRoleBinding' : 'RoleBinding'
    const id = `${type}-${bNs ?? 'cluster'}-${bName}`

    nodes.push({
      id,
      position: { x, y },
      data: { label: `${kindLabel}\n${bNs ? `${bNs}/` : ''}${bName}` },
      style: nodeStyle(type),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })

    edges.push({
      id: `e${++edgeIdx}`,
      source: id,
      target: 'role',
      label: 'roleRef',
      labelStyle: { fontSize: 9, fill: '#94a3b8' },
      labelBgStyle: { fill: '#0f1629', fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6a7fc9' },
      style: { stroke: '#6a7fc9', strokeWidth: 1.5 },
    })

    relationCount++
  }

  roleBindings.forEach((binding, idx) => addBindingNode(binding, 'rolebinding', 80, 70 + idx * 105))
  clusterRoleBindings.forEach((binding, idx) => addBindingNode(binding, 'clusterrolebinding', 760, 70 + idx * 105))

  return { nodes, edges, relationCount }
}

async function loadRelatedBindings(resourceType: RbacResourceType, full: Record<string, unknown>): Promise<{ roleBindings: BindingRecord[]; clusterRoleBindings: BindingRecord[] }> {
  const { name, namespace } = getMeta(full)

  if (resourceType === 'rolebindings' || resourceType === 'clusterrolebindings') {
    return { roleBindings: [], clusterRoleBindings: [] }
  }

  if (resourceType === 'roles') {
    const rbs = (await ResourceList('rolebindings', namespace)) as Array<Record<string, unknown>>
    const roleBindings = rbs
      .map(normalizeBinding)
      .filter((b) => b.roleRef?.kind === 'Role' && b.roleRef?.name === name)
    return { roleBindings, clusterRoleBindings: [] }
  }

  const [rbs, crbs] = await Promise.all([
    ResourceList('rolebindings', 'all'),
    ResourceList('clusterrolebindings', 'all'),
  ])

  const roleBindings = (rbs as Array<Record<string, unknown>>)
    .map(normalizeBinding)
    .filter((b) => b.roleRef?.kind === 'ClusterRole' && b.roleRef?.name === name)

  const clusterRoleBindings = (crbs as Array<Record<string, unknown>>)
    .map(normalizeBinding)
    .filter((b) => b.roleRef?.kind === 'ClusterRole' && b.roleRef?.name === name)

  return { roleBindings, clusterRoleBindings }
}

export function RbacFlowTab({
  full,
  resourceType,
}: {
  full: Record<string, unknown> | null
  resourceType: RbacResourceType
}) {
  const [relatedRoleBindings, setRelatedRoleBindings] = useState<BindingRecord[]>([])
  const [relatedClusterRoleBindings, setRelatedClusterRoleBindings] = useState<BindingRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!full) return

    let cancelled = false
    setError(null)
    setLoading(resourceType === 'roles' || resourceType === 'clusterroles')

    void (async () => {
      try {
        const related = await loadRelatedBindings(resourceType, full)
        if (cancelled) return
        setRelatedRoleBindings(related.roleBindings)
        setRelatedClusterRoleBindings(related.clusterRoleBindings)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'failed to load related bindings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [full, resourceType])

  const graph = useMemo(() => {
    if (!full) return { nodes: [] as Node[], edges: [] as Edge[], relationCount: 0 }

    if (resourceType === 'rolebindings' || resourceType === 'clusterrolebindings') {
      const built = buildBindingGraph(resourceType, full)
      return { ...built, relationCount: ((full.subjects as unknown[] | undefined)?.length ?? 0) + 1 }
    }

    return buildRoleGraph(resourceType, full, relatedRoleBindings, relatedClusterRoleBindings)
  }, [full, resourceType, relatedRoleBindings, relatedClusterRoleBindings])

  if (!full) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[11px] text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="rbac-flow-tab">
      <div className="shrink-0 flex items-center gap-4 px-5 py-2 border-b border-border/30 bg-accent/5 text-[10px] text-muted-foreground">
        <span className="font-semibold text-foreground/60">RBAC Flow</span>
        <span>{'binding -> roleRef -> role'}</span>
        <span className="ml-auto opacity-50">drag - scroll to zoom</span>
      </div>

      {loading && (
        <div className="px-5 py-2 text-[11px] text-muted-foreground border-b border-border/20">
          Loading related bindings...
        </div>
      )}

      {error && (
        <div className="px-5 py-2 text-[11px] text-red-400 border-b border-red-400/20 bg-red-500/5">
          {error}
        </div>
      )}

      {!loading && !error && graph.relationCount === 0 && (resourceType === 'roles' || resourceType === 'clusterroles') && (
        <div className="px-5 py-2 text-[11px] text-muted-foreground border-b border-border/20">
          No RoleBinding or ClusterRoleBinding currently references this {resourceType === 'roles' ? 'Role' : 'ClusterRole'}.
        </div>
      )}

      <div className="flex-1 min-h-0" style={{ background: '#0b1124' }}>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          fitView
          fitViewOptions={{ padding: 0.3 }}
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
