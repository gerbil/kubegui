/* eslint-disable react-hooks/exhaustive-deps */
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'
import { Boxes, Database, FileText, GitBranch, Globe, HardDrive, Network, Pencil, Radio, RefreshCw, Search, Shield, Sparkles, Terminal, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EventsGetForResource,
  ResourceDelete,
  ResourceEdit,
  ResourceGetDetails,
  ResourceGetHierarchy,
} from '../../../bindings/kubegui/services/backend'
import { BackendEventSource } from '../../lib/wailsBackendTransport'
import { INFORMER_RESOURCE_NAMES } from '../../lib/menu.config'
import { ConfirmDialog } from './Button'
import { PortForwardBadges } from './PortForwardBadges'
import { AnnotationsSection, DynamicResourceSection, EventsTimeline, LabelsSection, TooltipResourceSection } from './ResourceManifestOverview'
import { uiNotify } from './UiNotify'
import { UiTooltip } from './UiTooltip'
import { NetworkPolicyFlowTab } from '../../features/resources/NetworkPolicyFlowTab'
import { RbacFlowTab } from '../../features/resources/RbacFlowTab'
import { HIERARCHY_NAVIGATE_EVENT } from '../../lib/uiEvents'
import { AiAssistModal } from './AiAssistModal'
import type { AIAssistRequest } from '@/lib/aiAssistant'
/** Minimal info needed to open the drawer — satisfied by both K8sResource and ResourceRow */
export interface ResourceRef {
  uid?: string
  name: string
  namespace?: string
  kind?: string
  apiVersion?: string
}

type Tab = 'overview' | 'events' | 'edit' | 'logs' | 'shell' | 'netflow' | 'rbacflow' | 'hierarchy'

// ── Ace / jsyaml types ────────────────────────────────────────────────────────

type AceEditor = {
  setValue: (v: string, cursorPos?: number) => void
  getValue: () => string
  setOptions: (opts: Record<string, unknown>) => void
  setReadOnly: (v: boolean) => void
  getSession: () => {
    setMode?: (mode: string) => void
    setUseWrapMode?: (v: boolean) => void
    setTabSize?: (n: number) => void
    setUseSoftTabs?: (v: boolean) => void
    getAnnotations?: () => { type: string }[]
    on?: (event: string, cb: () => void) => void
    getUndoManager?: () => { markClean: () => void; isClean: () => boolean }
  }
  resize?: () => void
  destroy: () => void
}

type EditorWindow = Window & typeof globalThis & {
  ace?: { edit: (el: HTMLElement | string) => AceEditor }
  jsyaml?: { dump: (v: unknown) => string; load: (v: string) => unknown }
}

type TerminalWindow = Window & typeof globalThis & {
  getTerminal?: (ns: string, name: string, cname: string) => void
  disposeTerminal?: (id: string) => void
}

function summarizeResourceForAI(resourceType: string, namespace: string, name: string, full: Record<string, unknown> | null): string {
  const payload = {
    resourceType,
    namespace,
    name,
    kind: String(full?.kind ?? resourceType),
    apiVersion: String(full?.apiVersion ?? ''),
    metadata: full?.metadata,
    status: full?.status,
  }
  const raw = JSON.stringify(payload, null, 2)
  if (!raw) return `${resourceType} ${namespace}/${name}`
  return raw.length > 8000 ? `${raw.slice(0, 8000)}\n...truncated...` : raw
}

/**
 * Detects whether a resource is in a problematic state based on its status fields.
 * - needsFix=true  -> AI should diagnose and propose remediation steps.
 * - needsFix=false -> AI should just describe/explain the object (also used for
 *   resources without a meaningful health model, e.g. Services, ConfigMaps).
 */
function assessResourceHealth(resourceType: string, full: Record<string, unknown> | null): { needsFix: boolean; summary: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const status = (full?.status as Record<string, unknown> | undefined) ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec = (full?.spec as Record<string, unknown> | undefined) ?? {}
  const num = (v: unknown) => Number(v ?? 0)

  switch (resourceType) {
    case 'deployments': {
      const total = num(status.replicas) || num(spec.replicas)
      const ready = num(status.readyReplicas)
      const available = num(status.availableReplicas)
      const updated = num(status.updatedReplicas)
      const specReplicas = num(spec.replicas)
      const unhealthy =
        total > 0 &&
        (ready < total ||
          (specReplicas > 0 && available < specReplicas) ||
          num(status.unavailableReplicas) > 0 ||
          updated < specReplicas)
      return {
        needsFix: unhealthy,
        summary: unhealthy
          ? `Deployment is not fully available: ready=${ready}/${total}, up-to-date=${updated}, available=${available}, unavailable=${num(status.unavailableReplicas)}. A new-release pod may be stuck in ImagePullBackOff or CrashLoopBackOff.`
          : '',
      }
    }

    case 'replicasets':
    case 'replicationcontrollers': {
      const total = num(status.replicas) || num(spec.replicas)
      const ready = num(status.readyReplicas)
      const unhealthy = total > 0 && ready < total
      return { needsFix: unhealthy, summary: unhealthy ? `Only ${ready}/${total} replicas are ready.` : '' }
    }

    case 'statefulsets': {
      const total = num(status.replicas) || num(spec.replicas)
      const ready = num(status.readyReplicas)
      const available = num(status.availableReplicas)
      const unhealthy = total > 0 && (ready < total || (spec.replicas !== undefined && available < num(spec.replicas)))
      return { needsFix: unhealthy, summary: unhealthy ? `StatefulSet pods not fully available: ready=${ready}/${total}, available=${available}.` : '' }
    }

    case 'daemonsets': {
      const desired = num(status.desiredNumberScheduled)
      const ready = num(status.numberReady)
      const unhealthy = desired > 0 && ready < desired
      return { needsFix: unhealthy, summary: unhealthy ? `DaemonSet has ${ready}/${desired} daemons ready.` : '' }
    }

    case 'jobs': {
      const failed = num(status.failed)
      const active = num(status.active)
      const succeeded = num(status.succeeded)
      const completions = spec.completions ?? null
      if (failed > 0) return { needsFix: true, summary: `Job has ${failed} failed pod(s); succeeded=${succeeded}/${completions ?? '?'}.` }
      const incomplete = !spec.suspend && active === 0 && !!completions && succeeded < num(completions)
      return { needsFix: incomplete, summary: incomplete ? `Job has not completed successfully: succeeded=${succeeded}/${completions}.` : '' }
    }

    case 'cronjobs': {
      if (spec.suspend) return { needsFix: false, summary: '' }
      const lastSchedule = status.lastScheduleTime as string | undefined
      const lastSuccessful = status.lastSuccessfulTime as string | undefined
      if (!lastSchedule) return { needsFix: false, summary: '' }
      const broken = !lastSuccessful || new Date(lastSuccessful).getTime() < new Date(lastSchedule).getTime()
      return { needsFix: broken, summary: broken ? `CronJob's most recent run (${lastSchedule}) did not finish successfully.` : '' }
    }

    case 'pods': {
      const statuses = [
        ...((status.initContainerStatuses as unknown[] | undefined) ?? []),
        ...((status.containerStatuses as unknown[] | undefined) ?? []),
      ] as Array<{ name: string; ready: boolean; restartCount?: number; state?: { waiting?: { reason?: string }; terminated?: { reason?: string } } }>
      const bad = statuses.filter((cs) => cs.state?.waiting || (cs.state?.terminated && cs.state?.terminated?.reason !== 'Completed') || !cs.ready)
      if (!bad.length) return { needsFix: false, summary: '' }
      const detail = bad
        .map((cs) => {
          const s = cs.state ?? {}
          if (s.waiting) return `${cs.name}: waiting (${s.waiting.reason ?? ''}), restarts=${cs.restartCount ?? 0}`
          if (s.terminated) return `${cs.name}: ${s.terminated.reason ?? 'terminated'}`
          return `${cs.name}: not ready`
        })
        .join('; ')
      return { needsFix: true, summary: `Pod phase=${String(status.phase ?? 'Unknown')} — ${detail}.` }
    }

    default:
      // No health model for this kind (Services, ConfigMaps, Secrets, RBAC, CRDs…):
      // treat as informational and let the AI describe/explain it.
      return { needsFix: false, summary: '' }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isPod(resourceType: string) {
  return resourceType === 'pods'
}

function isNetworkPolicy(resourceType: string) {
  return resourceType === 'networkpolicies'
    || resourceType === 'ciliumnetworkpolicies'
    || resourceType === 'ciliumclusterwidenetworkpolicies'
}

function isRbacResource(resourceType: string) {
  return resourceType === 'roles'
    || resourceType === 'clusterroles'
    || resourceType === 'rolebindings'
    || resourceType === 'clusterrolebindings'
}

function isCRDResource(resourceType: string) {
  return !(INFORMER_RESOURCE_NAMES as readonly string[]).includes(resourceType)
}

function TabBtn({ id, label, icon, active, onClick }: {
  id: Tab; label: string; icon: React.ReactNode; active: boolean; onClick: (id: Tab) => void
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-[11.5px] font-modal font-semibold border-b-2 transition-colors ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}{label}
    </button>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

/**
 * Top-level keys that are rendered via dedicated sections (spec, status,
 * labels, annotations).  Any remaining top-level keys (e.g. Event fields like
 * involvedObject / reason / message, ConfigMap data, etc.) are shown in the
 * "Details" section so the Overview tab is never blank.
 */
const STANDARD_TOP_LEVEL_KEYS = new Set(['apiVersion', 'kind', 'metadata', 'spec', 'status'])

/**
 * Spec fields omitted from the details overview — pod templates, deep nested
 * objects, and fields that add noise without quick-glance value.
 */
const SPEC_OMIT = [
  'template',               // pod template (containers/volumes/etc.)
  'jobTemplate',            // CronJob → Job template
  'volumeClaimTemplates',   // StatefulSet PVC templates
  'selector',               // label selector (mirrors labels)
  'affinity',               // deep scheduling rules
  'tolerations',            // array of taint tolerations
  'topologySpreadConstraints',
  'readinessGates',
  'dnsConfig',
  'securityContext',        // pod-level security context (deep)
  'overhead',
  'os',
  'behavior',               // HPA scale behavior
  'defaultBackend',         // Ingress default backend object
  'configSource',           // Node dynamic config
  'rules',                  // Role/ClusterRole rules (verbose, not needed in overview)
  'subjects',               // RoleBinding/ClusterRoleBinding subjects (shown in RBAC Flow tab)
]

// ── Quota visualization helpers ────────────────────────────────────────────
function parseQuantity(q: string | number): number {
  if (typeof q === 'number') return q
  if (!q) return 0
  const str = String(q).trim()
  if (!str) return 0

  const units: Record<string, number> = {
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5,
    K: 1000, M: 1000 ** 2, G: 1000 ** 3, T: 1000 ** 4, P: 1000 ** 5,
    m: 0.001,
  }

  const match = str.match(/^([0-9.]+)([a-zA-Z%]*)$/)
  if (!match) return 0

  const num = parseFloat(match[1])
  const unit = match[2] || ''
  if (unit === '%') return num / 100
  if (unit === '') return num
  const multiplier = units[unit] || 1
  return num * multiplier
}

function formatQuantity(v: string | number): string {
  if (!v) return '0'
  return String(v)
}

function QuotaUsageBar({ label, hard, used }: { label: string; hard: string; used: string }) {
  const hardVal = parseQuantity(hard)
  const usedVal = parseQuantity(used)
  const pct = hardVal > 0 ? Math.min((usedVal / hardVal) * 100, 100) : 0
  const isHigh = pct >= 80
  const isCritical = pct >= 95

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground truncate flex-1">{label}</span>
        <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
          {formatQuantity(used)} / {formatQuantity(hard)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isCritical ? 'bg-red-500/80' : isHigh ? 'bg-amber-500/80' : 'bg-emerald-500/70'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ResourceQuotaSection({ full }: { full: Record<string, unknown> }) {
  const spec = full.spec as Record<string, unknown> | undefined
  const status = full.status as Record<string, unknown> | undefined
  const hard = spec?.hard ? (spec.hard as Record<string, string>) : {}
  const used = status?.used ? (status.used as Record<string, string>) : {}

  if (Object.keys(hard).length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-border bg-accent/10 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Resource Limits</h3>
      <div className="space-y-2">
        {Object.entries(hard).map(([key, hardVal]) => {
          const usedVal = used[key] ?? '0'
          return <QuotaUsageBar key={key} label={key} hard={hardVal} used={usedVal} />
        })}
      </div>
    </div>
  )
}

function OverviewTab({ full, resourceType, namespace, name }: { full: Record<string, unknown> | null; resourceType?: string; namespace?: string; name?: string }) {
  const [detailFilter, setDetailFilter] = useState('')

  useEffect(() => {
    setDetailFilter('')
  }, [full])

  if (!full) return <div className="flex-1 flex items-center justify-center"><p className="text-[11px] text-muted-foreground">Loading…</p></div>

  // Collect top-level fields that aren't handled by dedicated sections
  // (spec, status, labels, annotations).  Event objects store their payload
  // here (involvedObject, reason, message, type, count, timestamps, …).
  const extraTopLevel = Object.fromEntries(
    Object.entries(full).filter(([k, v]) => !STANDARD_TOP_LEVEL_KEYS.has(k) && v !== null && v !== undefined)
  )

  // Extract container ports for port-forwarding badges (pods only)
  const containerPorts = (() => {
    if (resourceType !== 'pods' || !full) return []
    const spec = full.spec as Record<string, unknown> | undefined
    const containers = (spec?.containers as Array<Record<string, unknown>> | undefined) ?? []
    const ports: Array<{ name?: string; containerPort: number; protocol?: string }> = []
    for (const c of containers) {
      const cports = (c.ports as Array<Record<string, unknown>> | undefined) ?? []
      for (const p of cports) {
        ports.push({
          name: p.name as string | undefined,
          containerPort: p.containerPort as number,
          protocol: p.protocol as string | undefined,
        })
      }
    }
    return ports
  })()

  const filterBar = (
    <div className="flex items-center gap-1.5 rounded border border-border/50 bg-accent/25 px-2 py-0.5 self-start">
      <Search size={11} className="text-muted-foreground/60 shrink-0" />
      <input
        value={detailFilter}
        onChange={(event) => setDetailFilter(event.target.value)}
        placeholder="filter…"
        className="w-32 bg-transparent font-modal text-[11px] text-foreground outline-none placeholder:text-muted-foreground/40"
      />
      {detailFilter && (
        <button
          onClick={() => setDetailFilter('')}
          className="text-[11px] leading-none text-muted-foreground hover:text-foreground"
          aria-label="Clear detail filter"
        >
          {String.fromCharCode(215)}
        </button>
      )}
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      {filterBar}
      {containerPorts.length > 0 && namespace && name && (
        <PortForwardBadges namespace={namespace} podName={name} ports={containerPorts} />
      )}
      {resourceType === 'resourcequotas' && <ResourceQuotaSection full={full} />}
      <DynamicResourceSection title="Details" data={extraTopLevel} query={detailFilter} />
      <TooltipResourceSection
        title="Spec"
        data={full.spec}
        sectionPrefix="spec"
        omit={SPEC_OMIT}
        query={detailFilter}
      />
      <TooltipResourceSection title="Status" data={full.status} sectionPrefix="status" query={detailFilter} />
      <AnnotationsSection resource={full} query={detailFilter} />
      <LabelsSection resource={full} query={detailFilter} />
    </div>
  )
}

// ── Events Tab ────────────────────────────────────────────────────────────────

const EVENTS_POLL_MS = 15_000

function EventsTab({ kind, namespace, name }: { kind: string; namespace: string; name: string }) {
  const [events, setEvents]   = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshTick, refresh] = useReducer((n: number) => n + 1, 0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Strip placeholder / plural kinds that won't match involvedObject.kind
  const effectiveKind = (!kind || kind === 'Unknown' || kind.toLowerCase() === kind) ? '' : kind

  const fetchEvents = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const raw = await EventsGetForResource(namespace, effectiveKind, name, 100)
      const list = Array.isArray(raw) ? raw
        : Array.isArray((raw as Record<string,unknown>)?.items)
          ? ((raw as Record<string,unknown>).items as unknown[])
          : []
      if (!signal.cancelled) {
        setEvents(list as Record<string, unknown>[])
        setLastUpdated(new Date())
        setError(null)
      }
    } catch (e) {
      if (!signal.cancelled) setError(e instanceof Error ? e.message : 'fetch error')
    } finally {
      if (!signal.cancelled) setLoading(false)
    }
  }, [effectiveKind, namespace, name])

  // Fetch on mount / resource change / manual refresh
  useEffect(() => {
    const signal = { cancelled: false }
    setLoading(true)
    void fetchEvents(signal)
    return () => { signal.cancelled = true }
  }, [fetchEvents, refreshTick])

  // Auto-poll every 15 s while the tab is mounted
  useEffect(() => {
    const id = window.setInterval(() => refresh(), EVENTS_POLL_MS)
    return () => window.clearInterval(id)
  }, [])

  const ago = lastUpdated
    ? (() => {
        const s = Math.round((Date.now() - lastUpdated.getTime()) / 1000)
        if (s < 5)  return 'just now'
        if (s < 60) return `${s}s ago`
        return `${Math.round(s / 60)}m ago`
      })()
    : null

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-5 py-1.5 border-b border-border/30 bg-accent/5 shrink-0">
        <span className="text-[10px] text-muted-foreground/50">
          {ago ? `Updated ${ago}` : ''}
        </span>
        <button
          onClick={() => { setLoading(true); refresh() }}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          title="Refresh events"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      <EventsTimeline events={events} loading={loading} error={error} />
    </div>
  )
}

/** Dispatch a navigate event handled by App.tsx */
function emitHierarchyNavigate(resource: string, namespace: string, name: string, apiVersion = '') {
  const normalizedResource = resource.trim().toLowerCase()
  const isInformerResource = (INFORMER_RESOURCE_NAMES as readonly string[]).includes(normalizedResource)
  const apiGroup = apiVersion.includes('/') ? apiVersion.split('/')[0] : ''

  const path = isInformerResource
    ? (normalizedResource === 'pods' ? '/pods' : `/resources/${encodeURIComponent(normalizedResource)}`)
    : apiGroup
      ? `/crds/${encodeURIComponent(apiGroup)}/${encodeURIComponent(normalizedResource)}`
      : `/resources/${encodeURIComponent(normalizedResource)}`

  const params = new URLSearchParams()
  if (namespace && namespace !== '_') params.set('namespace', namespace)
  if (name) params.set('q', name)
  const qs = params.toString()
  const href = qs ? `${path}?${qs}` : path
  window.dispatchEvent(new CustomEvent(HIERARCHY_NAVIGATE_EVENT, { detail: href }))
}

interface HierarchyNodeViewProps {
  node: Record<string, unknown>
  parentHasNext?: boolean[]
  isRoot?: boolean
  isLast?: boolean
}

function hierarchyNodeIcon(resource: string, kind: string) {
  const id = (resource || kind).toLowerCase()
  if (id.includes('pod') || id.includes('job') || id.includes('deployment') || id.includes('replicaset') || id.includes('statefulset') || id.includes('daemonset')) {
    return <Boxes size={12} className="text-emerald-300/85 shrink-0" />
  }
  if (id.includes('service') || id.includes('endpoint') || id.includes('ingress') || id.includes('networkpolicy')) {
    return <Network size={12} className="text-sky-300/85 shrink-0" />
  }
  if (id.includes('secret') || id.includes('role') || id.includes('binding') || id.includes('account')) {
    return <Shield size={12} className="text-violet-300/85 shrink-0" />
  }
  if (id.includes('configmap') || id.includes('storage') || id.includes('volume') || id.includes('pvc') || id.includes('pv')) {
    return <HardDrive size={12} className="text-amber-300/85 shrink-0" />
  }
  if (id.includes('node') || id.includes('namespace') || id.includes('cluster')) {
    return <Database size={12} className="text-cyan-300/85 shrink-0" />
  }
  if (id.includes('gateway') || id.includes('route') || id.includes('host')) {
    return <Globe size={12} className="text-blue-300/85 shrink-0" />
  }
  return <GitBranch size={12} className="text-muted-foreground/70 shrink-0" />
}

function HierarchyNodeView({ node, parentHasNext = [], isRoot = false, isLast = true }: HierarchyNodeViewProps) {
  const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
  const kind      = String(node.kind      ?? 'Unknown')
  const name      = String(node.name      ?? '')
  const namespace = String(node.namespace ?? '')
  const phase     = String(node.phase     ?? '')
  const apiVersion = String(node.apiVersion ?? '')
  const resource  = String(node.resource  ?? kind.toLowerCase())
  const icon = hierarchyNodeIcon(resource, kind)

  const childParentHasNext = isRoot ? parentHasNext : [...parentHasNext, !isLast]

  const handleClick = () => {
    if (resource && name) emitHierarchyNavigate(resource, namespace, name, apiVersion)
  }

  const phaseColor =
    phase === 'Running'   ? 'text-emerald-400/80' :
    phase === 'Failed'    ? 'text-red-400/80'     :
    phase === 'Pending'   ? 'text-yellow-400/80'  :
    phase === 'Succeeded' ? 'text-sky-400/80'     : 'text-muted-foreground/70'

  return (
    <div>
      {/* Row */}
      <button
        onClick={handleClick}
        title={`Go to ${kind}/${name}${namespace ? ` (${namespace})` : ''}`}
        className="group flex items-baseline gap-0 w-full text-left hover:bg-white/5 rounded transition-colors py-px"
      >
        {/* Connected tree guides */}
        <span className="inline-flex items-center shrink-0 font-mono text-[11px] text-muted-foreground/40 select-none">
          {parentHasNext.map((hasNext, idx) => (
            <span key={`${idx}-${hasNext ? '1' : '0'}`} className="w-3 text-center">
              {hasNext ? String.fromCharCode(9474) : String.fromCharCode(160)}
            </span>
          ))}
          {!isRoot && (
            <>
              <span className="w-3 text-center text-muted-foreground/55">{isLast ? String.fromCharCode(9492) : String.fromCharCode(9500)}</span>
              <span className="w-3 text-center text-muted-foreground/55">{String.fromCharCode(9472)}</span>
            </>
          )}
        </span>
        {/* Resource icon */}
        <span className="mx-1.5 inline-flex items-center justify-center">{icon}</span>
        {/* Kind badge */}
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 shrink-0 mr-1.5 leading-none self-center">
          {kind}
        </span>
        {/* Name — highlighted on hover */}
        <span className="text-[12px] text-foreground/90 font-medium group-hover:text-primary truncate leading-none" title={name}>
          {name || '—'}
        </span>
        {namespace && (
          <span className="ml-2 text-[10px] text-cyan-400/70 shrink-0 leading-none self-center">{namespace}</span>
        )}
        {phase && (
          <span className={`ml-1.5 text-[10px] shrink-0 leading-none self-center ${phaseColor}`}>[{phase}]</span>
        )}
      </button>

      {/* Children */}
      {children.map((child, idx) => {
        const last = idx === children.length - 1
        return (
          <HierarchyNodeView
            key={`${String(child.uid ?? '')}-${idx}`}
            node={child}
            parentHasNext={childParentHasNext}
            isRoot={false}
            isLast={last}
          />
        )
      })}
    </div>
  )
}

function HierarchyTab({ resourceType, namespace, name }: { resourceType: string; namespace: string; name: string }) {
  const [tree, setTree] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await ResourceGetHierarchy(resourceType, namespace, name)
      setTree((data as unknown as Record<string, unknown> | null) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load hierarchy')
    } finally {
      setLoading(false)
    }
  }, [name, namespace, resourceType])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><p className="text-[11px] text-muted-foreground">Loading hierarchy…</p></div>
  }

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      </div>
    )
  }

  if (!tree) {
    return <div className="flex-1 flex items-center justify-center"><p className="text-[11px] text-muted-foreground">No hierarchy data.</p></div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Hierarchy</h3>
        <button
          onClick={() => { void load() }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      <div className="font-mono text-[11px] leading-[1.6]">
        <HierarchyNodeView node={tree} isRoot={true} />
      </div>
    </div>
  )
}

// ── Edit YAML Tab ─────────────────────────────────────────────────────────────

/**
 * Strip server-managed noise before showing in the editor:
 * - metadata.managedFields  (huge, never editable)
 * - status                  (server-owned; re-populated on save)
 * Keeps metadata.resourceVersion for optimistic concurrency on save.
 */
function cleanForEdit(resource: Record<string, unknown>): Record<string, unknown> {
  const meta = resource.metadata as Record<string, unknown> | undefined
  const cleanedMeta: Record<string, unknown> = { ...meta }
  delete cleanedMeta['managedFields']
  const rest = { ...resource }
  delete rest.status
  return { ...rest, metadata: cleanedMeta }
}

function EditTab({
  resourceType, namespace, name, full, onSaved,
}: {
  resourceType: string; namespace: string; name: string
  full: Record<string, unknown> | null; onSaved: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef    = useRef<AceEditor | null>(null)
  const initYamlRef  = useRef<string>('')
  const [ready,          setReady]          = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [dirty,          setDirty]          = useState(false)
  const [hasSyntaxError, setHasSyntaxError] = useState(false)

  // Init Ace once full manifest arrives
  useEffect(() => {
    if (!full) return
    let cancelled = false
    void (async () => {
      try {
        const { ensureLegacyEditorAssets } = await import('./podLegacyAssets')
        await ensureLegacyEditorAssets()
        if (cancelled || !containerRef.current) return
        const win = window as EditorWindow
        if (!win.ace) return
        const cleaned = cleanForEdit(full)
        const yaml = win.jsyaml?.dump(cleaned) ?? JSON.stringify(cleaned, null, 2)
        if (editorRef.current) {
          editorRef.current.setValue(yaml, -1)
          editorRef.current.getSession().getUndoManager?.().markClean()
        } else {
          const ed = win.ace.edit(containerRef.current)
          configureAceYamlEditor(ed, { onValidationChange: setHasSyntaxError })
          ed.setValue(yaml, -1)
          ed.getSession().getUndoManager?.().markClean()
          ed.getSession().on?.('change', () => {
            setDirty(!ed.getSession().getUndoManager?.().isClean())
          })
          ed.resize?.()
          editorRef.current = ed
        }
        initYamlRef.current = yaml
        setDirty(false)
        if (!cancelled) setReady(true)
      } catch (e) { console.error('editor init failed', e) }
    })()
    return () => { cancelled = true }
  }, [full])

  useEffect(() => () => { editorRef.current?.destroy(); editorRef.current = null }, [])

  const discard = () => {
    const ed = editorRef.current
    if (!ed) return
    ed.setValue(initYamlRef.current, -1)
    ed.getSession().getUndoManager?.().markClean()
    setDirty(false)
  }

  const handleSave = async () => {
    if (!editorRef.current) return
    if (hasSyntaxError) {
      uiNotify.error('YAML syntax error — fix before saving')
      return
    }
    const yaml = editorRef.current.getValue()
    const win = window as EditorWindow
    let obj: unknown
    try {
      obj = win.jsyaml?.load(yaml) ?? JSON.parse(yaml)
    } catch (e) {
      uiNotify.error(`YAML parse error: ${e instanceof Error ? e.message : 'invalid'}`)
      return
    }
    setSaving(true)
    try {
      await ResourceEdit(resourceType, namespace, name, JSON.stringify(obj))
      uiNotify.success(`Saved ${resourceType}/${name}`)
      initYamlRef.current = yaml
      editorRef.current?.getSession().getUndoManager?.().markClean()
      setDirty(false)
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      uiNotify.error(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  if (!full) return <div className="flex-1 flex items-center justify-center"><p className="text-[11px] text-muted-foreground">Loading manifest…</p></div>

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span className="font-mono" />
        <span>{!ready ? 'Loading…' : hasSyntaxError ? '⚠ YAML syntax error' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
      </div>

      <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden">
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/70">
            Loading YAML editor…
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={discard}
          disabled={!ready || saving || !dirty}
          className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90"
        >
          Discard
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={!ready || saving || !dirty || hasSyntaxError}
          className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ── Logs Tab (pods only) ──────────────────────────────────────────────────────

function LogsTab({ namespace, name, containers }: { namespace: string; name: string; containers: string[] }) {
  const [lines, setLines]   = useState<string[]>([])
  const [error, setError]   = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [search, setSearch] = useState('')
  const [follow, setFollow] = useState(true)
  const [container, setContainer] = useState(containers[0] ?? '')
  const [aiAssistRequest, setAiAssistRequest] = useState<AIAssistRequest | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLines([]); setError(null); setConnected(false)
    const ns   = encodeURIComponent(namespace)
    const pod  = encodeURIComponent(name)
    const cname = encodeURIComponent(container)
    const src  = new BackendEventSource(`/resource/logs/pods/${ns}/${pod}/${cname}`)

    src.addEventListener('log', (e: Event) => {
      if (cancelled) return
      setConnected(true)
      const html = String((e as MessageEvent).data ?? '').trim()
      if (html) setLines((prev) => { const next = [...prev, html]; return next.length > 2000 ? next.slice(-2000) : next })
    })
    src.addEventListener('error', (e: Event) => {
      if (cancelled) return
      setError(String((e as MessageEvent).data ?? 'Stream error'))
    })
    src.onerror = () => { if (!cancelled && src.readyState === BackendEventSource.CLOSED) setError('Stream closed') }
    return () => { cancelled = true; src.close() }
  }, [namespace, name, container])

  useEffect(() => { if (follow) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [lines, follow])

  const filtered = search ? lines.filter(l => l.toLowerCase().includes(search.toLowerCase())) : lines

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-[#0d1117]">
      <div className="px-3 py-1.5 border-b border-border/40 flex items-center gap-2 shrink-0 bg-[#161b22] flex-wrap">
        <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        {containers.length > 1 && (
          <select value={container} onChange={e => setContainer(e.target.value)}
            className="bg-[#0d1117] border border-border/40 text-[11px] text-slate-300 rounded px-1.5 py-0.5 outline-none">
            {containers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search logs…"
          className="bg-[#0d1117] border border-border/40 text-[11px] text-slate-300 rounded px-2 py-0.5 w-44 focus:outline-none placeholder:text-muted-foreground/40" />
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer ml-auto select-none">
          <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} className="w-3 h-3 accent-emerald-500" />Follow
        </label>
            <button
              type="button"
              onClick={() => {
                const snippet = lines.slice(-120).join('\n')
                if (!snippet.trim()) {
                  uiNotify.info('No log lines yet')
                  return
                }
                setAiAssistRequest({
                  task: 'auto_detect',
                  resource: 'pod',
                  namespace,
                  name,
                  message: snippet,
                  details: `container=${container}`,
                })
              }}
                      className="text-[10px] font-medium text-violet-300 hover:text-violet-100 px-1.5 py-0.5 rounded border border-violet-500/30 hover:bg-violet-500/20 inline-flex items-center gap-1"
            >
                      <Sparkles size={10} />Ask AI
            </button>
        <button onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="text-[10px] text-muted-foreground hover:text-slate-300 px-1.5 py-0.5 rounded border border-border/30">↓</button>
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5" style={{ background: '#0d1117' }}>
        {filtered.length === 0 && !error && <span className="text-muted-foreground/40">Waiting for log stream…</span>}
        {filtered.map((html, i) => <div key={i} dangerouslySetInnerHTML={{ __html: html }} />)}
        <div ref={bottomRef} />
      </div>
          <AiAssistModal
            open={aiAssistRequest !== null}
            request={aiAssistRequest}
            onClose={() => setAiAssistRequest(null)}
          />
    </div>
  )
}

// ── Shell Tab (pods only) ─────────────────────────────────────────────────────

function ShellTab({ namespace, name, container }: { namespace: string; name: string; container: string }) {
  const shellRef    = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { ensureLegacyTerminalAssets } = await import('./podLegacyAssets')
        await ensureLegacyTerminalAssets()
        if (cancelled || !shellRef.current) return
        const win = window as TerminalWindow
        const termId = `terminal-${namespace}-${name}-${container}`
        terminalRef.current = termId
        if (win.getTerminal) {
          const el = document.createElement('div')
          el.id = termId; el.style.height = '100%'; el.style.width = '100%'
          shellRef.current.appendChild(el)
          win.getTerminal(namespace, name, container)
          setLoading(false)
        } else { setLoading(false) }
      } catch (err) { console.error('terminal init failed', err); setLoading(false) }
    })()
    return () => {
      cancelled = true
      if (terminalRef.current) (window as TerminalWindow).disposeTerminal?.(terminalRef.current)
    }
  }, [namespace, name, container])

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {loading && <div className="flex-1 flex items-center justify-center"><p className="text-[11px] text-muted-foreground">Initializing terminal…</p></div>}
      <div ref={shellRef} className="flex-1 overflow-hidden" />
    </div>
  )
}

// ── Main Drawer ───────────────────────────────────────────────────────────────

export interface ResourceDrawerProps {
  resource:     ResourceRef | null
  resourceType: string
  onClose:      () => void
  extraHeaderAction?: React.ReactNode
}

export function ResourceDrawer({ resource, resourceType, onClose, extraHeaderAction }: ResourceDrawerProps) {
  const [activeTab,        setActiveTab]        = useState<Tab>('overview')
  const [full,             setFull]             = useState<Record<string, unknown> | null>(null)
  const [fullLoading,      setFullLoading]      = useState(false)
  const [confirmDelete,    setConfirmDelete]    = useState(false)
  const [busy,             setBusy]             = useState(false)
  const [drawerAIRequest,  setDrawerAIRequest]  = useState<AIAssistRequest | null>(null)

  const namespace = resource?.namespace ?? ''
  const name      = resource?.name ?? ''

  // Load full manifest whenever resource changes
  useEffect(() => {
    if (!resource) { setFull(null); return }
    let cancelled = false
    setFull(null); setFullLoading(true)
    void (async () => {
      try {
        const data = await ResourceGetDetails(resourceType, namespace, name) as Record<string, unknown>
        if (!cancelled) setFull(data)
      } catch { /* ignore */ } finally {
        if (!cancelled) setFullLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [resource?.uid, resourceType, namespace, name])

  // Reset tab to overview on resource change
  useEffect(() => { if (resource) setActiveTab('overview') }, [resource?.uid])
  useEffect(() => { if (!resource) { setConfirmDelete(false); setBusy(false) } }, [resource])

  const handleDelete = useCallback(async () => {
    if (!resource) return
    setBusy(true)
    try {
      await ResourceDelete(resourceType, namespace, name)
      uiNotify.success(`Deleted ${resourceType}/${name}`)
      onClose()
    } catch (e) {
      uiNotify.error(`Delete failed: ${e instanceof Error ? e.message : 'unknown'}`)
      setBusy(false)
    }
  }, [resource, resourceType, namespace, name, onClose])

  const handleSaved = useCallback(() => {
    // Reload manifest after save
    if (!resource) return
    void (async () => {
      try {
        const data = await ResourceGetDetails(resourceType, namespace, name) as Record<string, unknown>
        setFull(data)
      } catch { /* ignore */ }
    })()
  }, [resource, resourceType, namespace, name])

  const containers: string[] = (
    (full?.spec as Record<string, unknown> | undefined)?.containers as Array<{ name: string }> | undefined
  )?.map(c => c.name) ?? []

  const visible = resource !== null

  const tabs: { id: Tab; label: string; icon: React.ReactNode; hidden?: boolean }[] = [
    { id: 'overview', label: 'Overview',  icon: <Boxes    size={13} /> },
    { id: 'events',   label: 'Events',    icon: <Radio    size={13} /> },
    { id: 'hierarchy', label: 'Hierarchy', icon: <GitBranch size={13} />, hidden: !isCRDResource(resourceType) },
    { id: 'logs',     label: 'Logs',      icon: <FileText size={13} />, hidden: !isPod(resourceType) },
    { id: 'shell',    label: 'Shell',     icon: <Terminal size={13} />, hidden: !isPod(resourceType) },
    { id: 'netflow',  label: 'Netflow',   icon: <GitBranch size={13} />, hidden: !isNetworkPolicy(resourceType) },
    { id: 'edit',     label: 'Edit YAML', icon: <Pencil   size={13} /> },
    { id: 'rbacflow', label: 'RBAC Flow', icon: <GitBranch size={13} />, hidden: !isRbacResource(resourceType) },
  ]

  const subtitleParts = [
    namespace && <span key="ns" className="text-cyan-400">{namespace}</span>,
    resource?.kind && <span key="kind">{resource.kind}</span>,
    resource?.apiVersion && <span key="av" className="opacity-40">{resource.apiVersion}</span>,
  ].filter(Boolean)

  const drawer = (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 z-[200] transition-opacity duration-200 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[800px] max-w-[100vw] z-[201] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Boxes size={15} className="text-primary shrink-0" />
              <span className="font-modal text-[15px] font-bold text-foreground truncate" title={name}>{name}</span>
            </div>
            <p className="font-modal text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {subtitleParts.reduce<React.ReactNode[]>((acc, el, i) => {
                if (i > 0) acc.push(<span key={`sep-${i}`} className="opacity-30">·</span>)
                acc.push(el)
                return acc
              }, [])}
            </p>
          </div>
          <UiTooltip content="Close" side="bottom">
            <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
              <X size={18} />
            </button>
          </UiTooltip>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-border bg-accent/10 px-5 shrink-0">
          {tabs
            .filter(
              t =>
                !t.hidden &&
                !(resource?.kind === 'Event' && t.id === 'events')
            )
            .map(t => (
              <TabBtn
                key={t.id}
                id={t.id}
                label={t.label}
                icon={t.icon}
                active={activeTab === t.id}
                onClick={setActiveTab}
              />
            ))}
          <div className="flex-1" />
          {extraHeaderAction && <div className="flex items-center">{extraHeaderAction}</div>}
          <div className="flex items-center gap-2 py-2">
            {fullLoading && <span className="text-[10px] text-muted-foreground animate-pulse">Loading…</span>}
            <button
              onClick={() => {
                const health = assessResourceHealth(resourceType, full)
                const kindLabel = String(resource?.kind ?? resourceType)
                setDrawerAIRequest({
                  task: health.needsFix ? 'suggest_fix' : 'explain_event',
                  resource: resource?.kind ?? resourceType,
                  namespace,
                  name,
                  message: health.needsFix && health.summary
                    ? `${health.summary}\n\n${summarizeResourceForAI(resourceType, namespace, name, full)}\n\nDiagnose the issue and provide step-by-step fix suggestions.`
                    : `Describe what this ${kindLabel} is and explain its current state and configuration in plain English.\n\n${summarizeResourceForAI(resourceType, namespace, name, full)}`,
                  details: `activeTab=${activeTab}; needsFix=${health.needsFix}`,
                })
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 transition-colors"
            >
              <Sparkles size={13} /> Ask AI
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {resource && activeTab === 'overview' && <OverviewTab full={full} resourceType={resourceType} namespace={namespace} name={name} />}
          {resource && activeTab === 'events'   && <EventsTab kind={resource.kind ?? resourceType} namespace={namespace} name={name} />}
          {resource && activeTab === 'hierarchy' && isCRDResource(resourceType) && (
            <HierarchyTab resourceType={resourceType} namespace={namespace} name={name} />
          )}
          {resource && activeTab === 'netflow'  && isNetworkPolicy(resourceType) && (
            <NetworkPolicyFlowTab full={full} />
          )}
          {resource && activeTab === 'rbacflow' && isRbacResource(resourceType) && (
            <RbacFlowTab
              full={full}
              resourceType={resourceType as 'roles' | 'clusterroles' | 'rolebindings' | 'clusterrolebindings'}
            />
          )}
          {resource && activeTab === 'logs'     && isPod(resourceType) && (
            <LogsTab namespace={namespace} name={name} containers={containers.length ? containers : [name]} />
          )}
          {resource && activeTab === 'shell'    && isPod(resourceType) && (
            <ShellTab namespace={namespace} name={name} container={containers[0] ?? name} />
          )}
          {resource && activeTab === 'edit'     && (
            <EditTab
              resourceType={resourceType}
              namespace={namespace}
              name={name}
              full={full}
              onSaved={handleSaved}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${resourceType}/${name}`}
        description={namespace
          ? `This will permanently delete "${name}" from namespace "${namespace}".`
          : `This will permanently delete cluster resource "${name}".`}
        confirmLabel="Delete"
        onConfirm={() => { setConfirmDelete(false); window.setTimeout(() => { void handleDelete() }, 0) }}
        onCancel={() => setConfirmDelete(false)}
      />
      <AiAssistModal
        open={drawerAIRequest !== null}
        request={drawerAIRequest}
        onClose={() => setDrawerAIRequest(null)}
      />
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(drawer, document.body)
}
