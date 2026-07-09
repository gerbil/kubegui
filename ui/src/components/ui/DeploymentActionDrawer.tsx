/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Container, Pencil, Radio, Trash2, X, Eye, FileText, RotateCw, Scaling } from 'lucide-react'
import { UiTooltip } from './UiTooltip'
import { uiNotify } from './UiNotify'
import { ensureLegacyEditorAssets } from './podLegacyAssets'
import { ResourceManifestOverview, LabelsSection, AnnotationsSection, EventsTimeline, type KubeEventItem } from './ResourceManifestOverview'
import { deploymentOverviewFields } from '../../features/resources/resourceOverview'
import { ConfirmDialog } from './Button'
import { BackendEventSource } from '../../lib/wailsBackendTransport'
import { EventsGetNamespace, ResourceGetDetails, ResourceList, ResourceEdit, ResourceDelete, DeploymentRestart, DeploymentScale } from '../../../bindings/kubegui/services/backend'
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'
import hljs from 'highlight.js/lib/core'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsYaml from 'highlight.js/lib/languages/yaml'
import hljsAccesslog from 'highlight.js/lib/languages/accesslog'

hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('yaml', hljsYaml)
hljs.registerLanguage('accesslog', hljsAccesslog)

async function listResourcesViaBinding(resource: string, namespace: string) {
  const data = await ResourceList(resource, namespace)
  return Array.isArray(data) ? data : []
}

type Tab = 'overview' | 'events' | 'logs' | 'edit'

type LegacyAceEditor = {
  setValue: (value: string, cursorPos?: number) => void
  getValue: () => string
  setOptions: (options: Record<string, unknown>) => void
  getSession: () => {
    setMode?: (mode: string) => void
    setUseWrapMode?: (enabled: boolean) => void
    setTabSize?: (size: number) => void
    setUseSoftTabs?: (enabled: boolean) => void
    on: (event: string, cb: () => void) => void
    getAnnotations?: () => { type: string; row: number; text: string }[]
    getUndoManager: () => { markClean: () => void; isClean: () => boolean }
  }
  destroy: () => void
  resize?: () => void
}

type LegacyEditorWindow = Window & typeof globalThis & {
  ace?: { edit: (el: HTMLElement | string) => LegacyAceEditor }
  jsyaml?: { dump: (value: unknown) => string; load: (value: string) => unknown }
}

export type DeploymentRow = {
  namespace: string
  name: string
  ready: number
  desired: number
  upToDate: number
  available: number
  createdAt: string
}

interface Props {
  deployment: DeploymentRow | null
  initialTab?: Tab
  onClose: () => void
  onDeleted?: (ns: string, name: string) => void
}

async function fetchDeploymentResource(ns: string, name: string): Promise<Record<string, unknown>> {
  try {
    const obj = await ResourceGetDetails('deployments', ns, name)
    if (obj && typeof obj === 'object') return obj as Record<string, unknown>
  } catch { /* fallback */ }

  const list = await listResourcesViaBinding('deployments', ns)
  const match = list.find((item) => {
    const meta = (item as Record<string, unknown>).metadata as Record<string, unknown> | undefined
    return String(meta?.name ?? '') === name && String(meta?.namespace ?? '') === ns
  })
  if (!match) throw new Error(`Deployment ${ns}/${name} not found`)
  return match as Record<string, unknown>
}

function cleanDeploymentForEdit(resource: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(resource)) as Record<string, unknown>
  const rest = { ...clone }
  delete rest.status
  const metadata = rest.metadata
  if (metadata && typeof metadata === 'object') {
    const meta = metadata as Record<string, unknown>
    delete meta.managedFields
    const annotations = meta.annotations
    if (annotations && typeof annotations === 'object') {
      delete (annotations as Record<string, unknown>)['kubectl.kubernetes.io/last-applied-configuration']
    }
  }
  return rest
}

async function fetchDeploymentEvents(ns: string, name: string): Promise<KubeEventItem[]> {
  try {
    const raw = await EventsGetNamespace(ns, 0)
    const list = Array.isArray(raw) ? raw : []
    return (list as KubeEventItem[]).filter((ev) => {
      const regarding = ev.regarding as Record<string, unknown> | undefined
      const ref = ev.involvedObject as Record<string, unknown> | undefined
      const evName = String(regarding?.name ?? ref?.name ?? '')
      const evKind = String(regarding?.kind ?? ref?.kind ?? '').toLowerCase()
      return evKind === 'deployment' && evName === name
    })
  } catch { return [] }
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-accent/20 p-3 space-y-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <span className="text-2xl font-bold font-mono leading-none" style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

function OverviewTab({ deployment }: { deployment: DeploymentRow }) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    fetchDeploymentResource(deployment.namespace, deployment.name)
      .then((d) => { if (!cancelled) { setDetails(d); } })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'fetch error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [deployment.namespace, deployment.name])

  if (loading) return <p className="text-xs text-muted-foreground p-4">Loading deployment details…</p>
  if (err) return <p className="text-xs text-red-400 p-4">Error: {err}</p>
  if (!details) return <p className="text-xs text-muted-foreground p-4">No details available.</p>

  const readyColor = deployment.ready >= deployment.desired && deployment.desired > 0 ? '#10b981'
    : deployment.ready > 0 ? '#f59e0b' : '#ef4444'

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="Desired" value={String(deployment.desired)} color="#38bdf8" />
        <MetricCard label="Ready" value={String(deployment.ready)} color={readyColor} />
        <MetricCard label="Up-to-date" value={String(deployment.upToDate)} color="#a78bfa" />
        <MetricCard label="Available" value={String(deployment.available)} color="#34d399" />
      </div>
      <ResourceManifestOverview resource={details} fields={deploymentOverviewFields} />
      <LabelsSection resource={details} />
      <AnnotationsSection resource={details} />
    </div>
  )
}

function EventsTab({ deployment }: { deployment: DeploymentRow }) {
  const [events, setEvents] = useState<KubeEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    fetchDeploymentEvents(deployment.namespace, deployment.name)
      .then((ev) => { if (!cancelled) setEvents(ev) })
      .catch((e: unknown) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'fetch error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [deployment.namespace, deployment.name])

  return <EventsTimeline events={events} loading={loading} error={err} />
}

// ── Log utilities (mirrors PodActionDrawer) ───────────────────────────────────

const LOG_LEVEL_RE = /^(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL|CRITICAL)(\s*[:：]\s*)/i
const LOG_LEVEL_COLORS: Record<string, string> = {
  ERROR:    '#f87171',
  FATAL:    '#f87171',
  CRITICAL: '#f87171',
  WARN:     '#fbbf24',
  WARNING:  '#fbbf24',
  INFO:     '#60a5fa',
  DEBUG:    '#a3e635',
  TRACE:    '#94a3b8',
}

function decodeHtmlEntities(s: string): string {
  let decoded = s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
  return decoded.replace(/\t/g, '  ')
}

const POD_LOG_HTML_PATTERN = /<div class="([^"]+)"><span class="[^"]+">[\s\S]*?<\/span><span class="log-circle\s+([^"]+)"><\/span><span class="code">([\s\S]*?)<\/span><\/div>/i

interface ParsedLogLine {
  severityClass: string
  message: string
}

function parseDeploymentLogLine(html: string): ParsedLogLine {
  const match = html.match(POD_LOG_HTML_PATTERN)
  if (match) {
    return { severityClass: match[2] || 'log-normal', message: decodeHtmlEntities(match[3] || '') }
  }
  // Plain text fallback (no wrapping HTML)
  return { severityClass: 'log-normal', message: decodeHtmlEntities(html.replace(/<[^>]+>/g, '')) }
}

function highlightBody(message: string): string {
  const trimmed = message.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return hljs.highlight(trimmed, { language: 'json' }).value } catch { /* fall through */ }
  }
  try {
    return hljs.highlightAuto(message, ['json', 'yaml', 'bash', 'accesslog']).value
  } catch {
    return hljs.highlight(message, { language: 'plaintext' }).value
  }
}

function highlightLogLine(message: string): string {
  const levelMatch = message.match(LOG_LEVEL_RE)
  if (levelMatch) {
    const level  = levelMatch[1].toUpperCase()
    const sep    = levelMatch[2]
    const rest   = message.slice(levelMatch[0].length)
    const color  = LOG_LEVEL_COLORS[level] ?? '#94a3b8'
    return `<span style="color:${color};font-weight:600">${level}</span><span style="color:#64748b">${sep}</span>${rest ? highlightBody(rest) : ''}`
  }
  return highlightBody(message)
}

function getLogTone(severityClass: string, message: string): 'normal' | 'warning' | 'error' {
  const lower = message.toLowerCase()
  if (severityClass.includes('error') || /\b(error|err|fatal|panic|failed|exception|traceback)\b/.test(lower)) return 'error'
  if (severityClass.includes('warning') || /\b(warn|warning|timeout|deprecated|retrying)\b/.test(lower)) return 'warning'
  return 'normal'
}

function applySearchHighlight(html: string, search: string): string {
  if (!search) return html
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'gi')
  return html.replace(/>([^<]*)</g, (_, text) =>
    '>' + text.replace(re, (m: string) => `<mark class="log-search-hit">${m}</mark>`) + '<'
  )
}

// ── Logs tab ──────────────────────────────────────────────────────────────────
async function fetchDeploymentPods(ns: string, name: string): Promise<string[]> {
  try {
    const list = await listResourcesViaBinding('pods', ns)
    return (list as Record<string,unknown>[])
      .filter((p) => {
        const meta = p.metadata as Record<string,unknown> | undefined
        const owners = Array.isArray(meta?.ownerReferences)
          ? (meta!.ownerReferences as Record<string,unknown>[]) : []
        return owners.some((o) =>
          String(o.kind ?? '').toLowerCase() === 'replicaset' &&
          String(o.name ?? '').startsWith(name)
        )
      })
      .map((p) => String((p.metadata as Record<string,unknown>)?.name ?? ''))
      .filter(Boolean)
  } catch { return [] }
}

function LogsTab({ deployment }: { deployment: DeploymentRow }) {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [follow, setFollow] = useState(true)
  const [pods, setPods] = useState<string[]>([])
  const [selectedPod, setSelectedPod] = useState<string>('')
  const logRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fetchDeploymentPods(deployment.namespace, deployment.name).then((list) => {
      setPods(list)
      setSelectedPod(list[0] ?? '')
    })
  }, [deployment.namespace, deployment.name])

  useEffect(() => {
    if (!selectedPod) return
    setLines([])
    setError(null)
    setConnected(false)
    const url = `/resource/logs/deployments/${encodeURIComponent(deployment.namespace)}/${encodeURIComponent(deployment.name)}`
    const es = new BackendEventSource(url)
    const handleLog = (e: Event) => {
      const msg = e as MessageEvent
      setConnected(true)
      const html = String(msg.data ?? '').trim()
      if (!html) return
      setLines((prev) => {
        const next = [...prev, html]
        return next.length > 2000 ? next.slice(-2000) : next
      })
    }
    const handleError = (e: Event) => {
      const msg = e as MessageEvent
      setError(String(msg.data ?? 'Stream error'))
    }
    es.addEventListener('log', handleLog)
    es.addEventListener('error', handleError)
    es.onerror = () => { if (es.readyState === BackendEventSource.CLOSED) setError('Stream closed') }
    return () => { es.removeEventListener('log', handleLog); es.removeEventListener('error', handleError); es.close() }
  }, [deployment.namespace, deployment.name, selectedPod])

  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, follow])

  const parsedLines = lines.map(parseDeploymentLogLine)
  const filteredLines = search
    ? parsedLines.filter((l) => l.message.toLowerCase().includes(search.toLowerCase()))
    : parsedLines

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-accent/10">
      <div className="px-3 py-1.5 border-b border-border/40 flex items-center gap-2 shrink-0 bg-accent/30 flex-wrap">
        <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        {pods.length > 0 && (
          <div className="relative group">
            <select
              value={selectedPod}
              onChange={(e) => setSelectedPod(e.target.value)}
              className="log-viewer-select"
            >
              {pods.map((p) => (
                <option key={p} value={p} className="bg-accent/40">{p}</option>
              ))}
            </select>
          </div>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs..."
          className="bg-accent/10 border border-border/40 text-[11px] text-slate-300 rounded px-2 py-0.5 w-44 focus:outline-none placeholder:text-muted-foreground/40"
          autoComplete="off"
          spellCheck={false}
        />
        <label className="flex items-center gap-1 font-modal text-[11px] text-muted-foreground cursor-pointer ml-auto select-none">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="w-3 h-3 accent-emerald-500" />
          Follow
        </label>
        <button
          type="button"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="font-modal text-[11px] text-muted-foreground hover:text-slate-300 px-1.5 py-0.5 rounded border border-border/30 hover:border-border/60 transition-colors"
          title="Scroll to bottom"
        >↓</button>
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>

      <div ref={logRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5 log-viewer-styles">
        <style>{`
          .log-viewer-styles .log-line{display:flex;align-items:flex-start;gap:4px;padding:2px 0;border-radius:4px}
          .log-viewer-styles .log-line:hover{background:rgba(255,255,255,0.04)}
          .log-viewer-styles .log-line.log-tone-warning{background:rgba(245,158,11,0.05)}
          .log-viewer-styles .log-line.log-tone-error{background:rgba(239,68,68,0.06)}
          .log-viewer-styles .code{font-family:Consolas,monospace;color:#dbe7ff;white-space:pre-wrap;word-break:break-word;flex:1;letter-spacing:-0.01em}
          .log-viewer-styles .hljs{background:transparent;padding:0}
          .log-viewer-styles .hljs-string{color:#98c379}
          .log-viewer-styles .hljs-number{color:#d19a66}
          .log-viewer-styles .hljs-literal,.log-viewer-styles .hljs-built_in{color:#56b6c2}
          .log-viewer-styles .hljs-keyword{color:#c678dd}
          .log-viewer-styles .hljs-attr{color:#e06c75}
          .log-viewer-styles .hljs-comment{color:#5c6370;font-style:italic}
          .log-viewer-styles .hljs-title{color:#61afef}
          .log-viewer-styles .hljs-variable{color:#e5c07b}
          .log-viewer-styles .log-search-hit{background:#fbbf24;color:#111827;border-radius:3px;padding:0 1px;box-shadow:0 0 0 1px rgba(251,191,36,0.25)}
        `}</style>
        {filteredLines.length === 0 && !error && (
          <span className="text-muted-foreground/40">Waiting for log stream…</span>
        )}
        {filteredLines.map((line, i) => {
          const tone = getLogTone(line.severityClass, line.message)
          return (
            <div key={i} className={`log-line log-tone-${tone}`}>
              <span
                className="code hljs"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: applySearchHighlight(highlightLogLine(line.message), search) }}
              />
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function EditTab({ deployment, onSaved }: { deployment: DeploymentRow; onSaved?: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<LegacyAceEditor | null>(null)
  const baselineYamlRef = useRef('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [hasSyntaxError, setHasSyntaxError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const setup = async () => {
      setLoading(true); setErr(null); setDirty(false); setHasSyntaxError(false)
      try {
        await ensureLegacyEditorAssets()
        if (cancelled) return
        const win = window as LegacyEditorWindow
        if (!hostRef.current || !win.ace || !win.jsyaml) throw new Error('Legacy YAML editor runtime is not available')
        const editor = win.ace.edit(hostRef.current)
        editorRef.current = editor
        configureAceYamlEditor(editor)
        const json = await fetchDeploymentResource(deployment.namespace, deployment.name)
        const yamlText = win.jsyaml.dump(cleanDeploymentForEdit(json))
        if (cancelled) return
        baselineYamlRef.current = yamlText
        editor.setValue(yamlText, -1)
        editor.getSession().getUndoManager().markClean()
        const refreshFlags = () => {
          setDirty(!editor.getSession().getUndoManager().isClean())
          const annotations = (editor.getSession().getAnnotations?.() ?? []) as { type: string }[]
          setHasSyntaxError(annotations.some((a) => a?.type === 'error'))
        }
        editor.getSession().on('change', refreshFlags)
        editor.getSession().on('changeAnnotation', refreshFlags)
        editor.resize?.()
        refreshFlags()
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'editor setup failed'
        setErr(msg)
        uiNotify.error(`Failed to load deployment YAML editor: ${msg}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void setup()
    return () => {
      cancelled = true
      const editor = editorRef.current; editorRef.current = null
      if (editor) editor.destroy()
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [deployment.namespace, deployment.name])

  const save = async () => {
    const editor = editorRef.current
    if (!editor) return
    if (hasSyntaxError) {
      setErr('YAML validation failed. Fix editor errors before saving.')
      return
    }
    setSaving(true); setErr(null)
    try {
      const win = window as LegacyEditorWindow
      if (!win.jsyaml) throw new Error('YAML parser is not available')
      const yamlText = editor.getValue()
      const parsedPatch = win.jsyaml.load(yamlText)
      const clone = parsedPatch && typeof parsedPatch === 'object'
        ? (JSON.parse(JSON.stringify(parsedPatch)) as Record<string, unknown>)
        : ({} as Record<string, unknown>)
      delete clone.status
      const meta = clone.metadata as Record<string, unknown> | undefined
      if (meta) { delete meta.resourceVersion; delete meta.managedFields; delete meta.uid; delete meta.creationTimestamp; delete meta.generation }
      const formBody = new URLSearchParams({ patch: JSON.stringify(clone) })
      await ResourceEdit('deployments', deployment.namespace, deployment.name, formBody.get('patch') ?? JSON.stringify(clone))
      baselineYamlRef.current = yamlText
      editor.getSession().getUndoManager().markClean()
      setDirty(false)
      uiNotify.success(`Deployment ${deployment.name} updated successfully`)
      onSaved?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'save failed'
      setErr(msg); uiNotify.error(`YAML save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.setValue(baselineYamlRef.current, -1)
    editor.getSession().getUndoManager().markClean()
    setDirty(false)
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {err && <p className="text-xs text-red-400">Error: {err}</p>}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span className="font-mono" />
        <span>{loading ? 'Loading…' : hasSyntaxError ? '⚠ YAML syntax error' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
      </div>
      <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden">
        <div ref={hostRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background/70">
            Loading YAML editor…
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={discard} disabled={loading || saving || !dirty}
          className="px-4 py-1.5 rounded text-xs font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90">
          Discard
        </button>
        <button onClick={() => void save()} disabled={loading || saving || !dirty || hasSyntaxError}
          className="px-4 py-1.5 rounded text-xs font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

function ActionBtn({ icon, label, onClick, disabled = false, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
               : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/60'
      }`}>
      {icon}{label}
    </button>
  )
}

export function DeploymentActionDrawer({ deployment, initialTab = 'overview', onClose, onDeleted }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [busy, setBusy] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [scaleValue, setScaleValue] = useState('')
  const [scaling, setScaling] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    if (deployment) { setActiveTab(initialTab); setScaleValue(String(deployment.desired)) }
  }, [deployment?.name, deployment?.namespace, initialTab])

  useEffect(() => {
    if (!deployment) { setConfirmDeleteOpen(false); setBusy(false); setScaleOpen(false) }
  }, [deployment])

  const restart = async () => {
    if (!deployment || restarting) return
    setRestarting(true)
    try {
      await DeploymentRestart(deployment.namespace, deployment.name)
      uiNotify.success(`Restarting deployment ${deployment.name}…`)
    } catch (e) {
      uiNotify.error(`Restart failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setRestarting(false)
    }
  }

  const scale = async () => {
    if (!deployment || scaling) return
    const replicas = parseInt(scaleValue, 10)
    if (isNaN(replicas) || replicas < 0) { uiNotify.error('Invalid replica count'); return }
    setScaling(true)
    try {
      await DeploymentScale(deployment.namespace, deployment.name, replicas)
      uiNotify.success(`Scaled ${deployment.name} to ${replicas} replica(s)`)
      setScaleOpen(false)
    } catch (e) {
      uiNotify.error(`Scale failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setScaling(false)
    }
  }

  const visible = deployment !== null

  const deleteDeployment = async () => {
    if (!deployment) return
    setBusy(true)
    const { namespace, name } = deployment
    try {
      await ResourceDelete('deployments', namespace, name)
      uiNotify.success(`Deleted deployment ${name}`)
      onClose()
      setTimeout(() => onDeleted?.(namespace, name), 220)
    } catch (e) {
      uiNotify.error(`Delete failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      setBusy(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview',  icon: <Eye size={13} /> },
    { id: 'events',   label: 'Events',    icon: <Radio size={13} /> },
    { id: 'logs',     label: 'Logs',      icon: <FileText size={13} /> },
    { id: 'edit',     label: 'Edit YAML', icon: <Pencil size={13} /> },
  ]

  const drawer = (
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[999] transition-opacity duration-200 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[760px] max-w-[100vw] z-[1000] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Container size={15} className="text-primary shrink-0" />
              <span className="font-mono text-sm font-bold text-foreground truncate">{deployment?.name}</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              <span>{deployment?.namespace}</span> &nbsp;·&nbsp;
              <span>{deployment?.ready}/{deployment?.desired} ready</span>
            </p>
          </div>
          <UiTooltip content="Close panel" side="bottom">
            <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
              <X size={18} />
            </button>
          </UiTooltip>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-border bg-accent/10 px-5">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-2 py-2">
            {/* Scale */}
            {scaleOpen ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="number" min={0} max={999}
                  value={scaleValue}
                  onChange={(e) => setScaleValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void scale(); if (e.key === 'Escape') setScaleOpen(false) }}
                  className="w-16 px-2 py-1 rounded text-[11px] lucid-control border border-border text-center focus:outline-none focus:border-primary"
                  autoFocus
                />
                <button onClick={() => void scale()} disabled={scaling}
                  className="px-2 py-1 rounded text-[10px] font-semibold border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50">
                  {scaling ? '…' : 'Apply'}
                </button>
                <button onClick={() => setScaleOpen(false)} className="px-2 py-1 rounded text-[10px] border border-border text-muted-foreground hover:text-foreground">✕</button>
              </div>
            ) : (
              <ActionBtn icon={<Scaling size={13} />} label="Scale" onClick={() => { setScaleValue(String(deployment?.desired ?? 1)); setScaleOpen(true) }} disabled={busy} />
            )}
            <ActionBtn icon={<RotateCw size={13} className={restarting ? 'animate-spin' : ''} />} label="Restart" onClick={() => void restart()} disabled={busy || restarting} />
            <ActionBtn icon={<Trash2 size={13} />} label="Delete" onClick={() => setConfirmDeleteOpen(true)} disabled={busy} danger />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {deployment && activeTab === 'overview' && <OverviewTab deployment={deployment} />}
          {deployment && activeTab === 'events'   && <EventsTab deployment={deployment} />}
          {deployment && activeTab === 'logs'     && <LogsTab deployment={deployment} />}
          {deployment && activeTab === 'edit'     && <EditTab deployment={deployment} />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete deployment "${deployment?.name ?? ''}"`}
        description={`This will delete the deployment in namespace "${deployment?.namespace ?? ''}".`}
        confirmLabel="Delete deployment"
        onConfirm={() => { setConfirmDeleteOpen(false); window.setTimeout(() => { void deleteDeployment() }, 0) }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(drawer, document.body)
}
