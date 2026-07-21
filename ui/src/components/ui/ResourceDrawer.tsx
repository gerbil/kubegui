/* eslint-disable react-hooks/exhaustive-deps */
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'
import { Boxes, FileText, GitBranch, Pencil, Radio, RefreshCw, Search, Terminal, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EventsGetForResource,
  ResourceDelete,
  ResourceEdit,
  ResourceGetDetails,
} from '../../../bindings/kubegui/services/backend'
import { BackendEventSource } from '../../lib/wailsBackendTransport'
import { ConfirmDialog } from './Button'
import { PortForwardBadges } from './PortForwardBadges'
import { AnnotationsSection, DynamicResourceSection, EventsTimeline, LabelsSection, TooltipResourceSection } from './ResourceManifestOverview'
import { uiNotify } from './UiNotify'
import { UiTooltip } from './UiTooltip'
import { NetworkPolicyFlowTab } from '../../features/resources/NetworkPolicyFlowTab'
/** Minimal info needed to open the drawer — satisfied by both K8sResource and ResourceRow */
export interface ResourceRef {
  uid?: string
  name: string
  namespace?: string
  kind?: string
  apiVersion?: string
}

type Tab = 'overview' | 'events' | 'edit' | 'logs' | 'shell' | 'netflow'

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

// ── helpers ───────────────────────────────────────────────────────────────────

function isPod(resourceType: string) {
  return resourceType === 'pods'
}

function isNetworkPolicy(resourceType: string) {
  return resourceType === 'networkpolicies'
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
]

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
        <button onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="text-[10px] text-muted-foreground hover:text-slate-300 px-1.5 py-0.5 rounded border border-border/30">↓</button>
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5" style={{ background: '#0d1117' }}>
        {filtered.length === 0 && !error && <span className="text-muted-foreground/40">Waiting for log stream…</span>}
        {filtered.map((html, i) => <div key={i} dangerouslySetInnerHTML={{ __html: html }} />)}
        <div ref={bottomRef} />
      </div>
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
    { id: 'logs',     label: 'Logs',      icon: <FileText size={13} />, hidden: !isPod(resourceType) },
    { id: 'shell',    label: 'Shell',     icon: <Terminal size={13} />, hidden: !isPod(resourceType) },
    { id: 'edit',     label: 'Edit YAML', icon: <Pencil   size={13} /> },
    { id: 'netflow',  label: 'Netflow',   icon: <GitBranch size={13} />, hidden: !isNetworkPolicy(resourceType) },
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
          {resource && activeTab === 'netflow'  && isNetworkPolicy(resourceType) && (
            <NetworkPolicyFlowTab full={full} />
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
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(drawer, document.body)
}
