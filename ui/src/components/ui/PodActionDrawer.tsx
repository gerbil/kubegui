/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Boxes, Radio, Terminal, Trash2, FileText, Pencil } from 'lucide-react'
import { UiTooltip } from './UiTooltip'
import { uiNotify } from './UiNotify'
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'
import { ConfirmDialog } from './Button'
import { podOverviewFields } from '../../features/resources/resourceOverview'
import { ResourceManifestOverview } from './ResourceManifestOverview'
import { LabelsSection, AnnotationsSection, EventsTimeline } from './ResourceManifestOverview'
import { PortForwardBadges } from './PortForwardBadges'
import { BackendEventSource } from '../../lib/wailsBackendTransport'
import { Events } from '@wailsio/runtime'
import { EventsGetResource, ResourceGetDetails, ResourceDelete, ResourceEdit, PodGetMetricsByNameFromDB, StartPodShellSession, SendPodShellInput, ResizePodShellSession, StopPodShellSession } from '../../../bindings/kubegui/services/backend'
import hljs from 'highlight.js/lib/core'
import hljsJson from 'highlight.js/lib/languages/json'
import hljsBash from 'highlight.js/lib/languages/bash'
import hljsYaml from 'highlight.js/lib/languages/yaml'
import hljsAccesslog from 'highlight.js/lib/languages/accesslog'
import 'highlight.js/styles/atom-one-dark.css'

hljs.registerLanguage('json', hljsJson)
hljs.registerLanguage('bash', hljsBash)
hljs.registerLanguage('yaml', hljsYaml)
hljs.registerLanguage('accesslog', hljsAccesslog)

type Tab = 'overview' | 'events' | 'logs' | 'shell' | 'edit'

type AceAnnotation = { type?: string }

type LegacyTerminalWindow = Window & typeof globalThis & {
  getTerminal?: (ns: string, cleanname: string, cname: string, nodeflag?: boolean) => void
  disposeTerminal?: (id: string) => void
}

type LegacyAceEditor = {
  setValue: (value: string, cursorPos?: number) => void
  getValue: () => string
  setOptions: (options: Record<string, unknown>) => void
  getSession: () => {
    setMode?: (mode: string) => void
    setUseWrapMode?: (enabled: boolean) => void
    setTabSize?: (size: number) => void
    setUseSoftTabs?: (enabled: boolean) => void
    getUndoManager: () => { markClean: () => void; isClean: () => boolean }
    getAnnotations: () => AceAnnotation[]
    on: (event: string, cb: () => void) => void
  }
  on: (event: string, cb: () => void) => void
  resize?: () => void
  destroy: () => void
}

type LegacyEditorWindow = Window & typeof globalThis & {
  ace?: { edit: (el: HTMLElement | string) => LegacyAceEditor }
  jsyaml?: { dump: (value: unknown) => string; load: (value: string) => unknown }
}

export interface PodContainerStatus {
  name: string
  ready: boolean
  restartCount: number
  state?: {
    waiting?: { reason?: string }
    running?: object
    terminated?: { reason?: string }
  }
}

export interface PodRow {
  namespace: string
  name: string
  phase: string
  statusText: string
  node: string
  restarts: number
  createdAt: string
  primaryContainer: string
  containerStatuses: PodContainerStatus[]
  schedulingReason?: string
  schedulingMessage?: string
}

interface Props {
  pod: PodRow | null
  initialTab?: Tab
  onClose: () => void
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(160)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(Math.floor(w))
    })
    obs.observe(containerRef.current)
    setWidth(Math.floor(containerRef.current.offsetWidth))
    return () => obs.disconnect()
  }, [])

  if (data.length < 2) {
    return (
      <div ref={containerRef} style={{ height }} className="w-full flex items-center justify-center">
        <span className="text-[9px] text-muted-foreground/30">no data</span>
      </div>
    )
  }

  const padT = 4, padB = 4, padL = 4, padR = 4
  const gw = width - padL - padR
  const gh = height - padT - padB
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => {
    const x = padL + (i / (data.length - 1)) * gw
    const y = padT + gh - (v / max) * gh
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const latest = data[data.length - 1] ?? 0
  const gradId = `sg-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`

  return (
    <div ref={containerRef} style={{ height }} className="w-full relative">
      <svg width={width} height={height} className="absolute inset-0">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <polygon points={`${padL},${height - padB} ${pts} ${width - padR},${height - padB}`} fill={`url(#${gradId})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
      <span className="absolute bottom-1 right-1 text-[9px] font-mono" style={{ color }}>{latest.toFixed(2)}</span>
    </div>
  )
}

function MetricCard({ label, unit, data, color }: { label: string; unit: string; data: number[]; color: string }) {
  const latest = data.length > 0 ? (data[data.length - 1] ?? 0) : null
  return (
    <div className="rounded-md border border-border bg-accent/20 p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
        <span className="text-[11px] font-mono font-bold" style={{ color }}>
          {latest !== null ? `${latest.toFixed(2)} ${unit}` : '—'}
        </span>
      </div>
      <Sparkline data={data} color={color} height={44} />
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ pod }: { pod: PodRow }) {
  const [resource, setResource] = useState<Record<string, unknown> | null>(null)
  const [loadingResource, setLoadingResource] = useState(true)
  const [cpuData, setCpuData] = useState<number[]>([])
  const [memData, setMemData] = useState<number[]>([])
  const [loadingMetrics, setLoadingMetrics] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await ResourceGetDetails('pods', pod.namespace, pod.name) as Record<string, unknown>
        if (!cancelled) setResource(data)
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoadingResource(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [pod.namespace, pod.name])

  useEffect(() => {
    let cancelled = false
    const loadMetrics = async () => {
      setLoadingMetrics(true)
      try {
        const rows = await PodGetMetricsByNameFromDB(pod.name, pod.namespace)
        const timeline = [...(rows ?? [])].reverse()
        const cpu = timeline.map((r) => Number(r.Cpu) || 0)
        const mem = timeline.map((r) => (Number(r.Memory) || 0) / (1024 * 1024))
        if (!cancelled) { setCpuData(cpu); setMemData(mem) }
      } catch { /* no metrics */ } finally {
        if (!cancelled) setLoadingMetrics(false)
      }
    }
    void loadMetrics()
    return () => { cancelled = true }
  }, [pod.namespace, pod.name])

  const containerPorts = (() => {
    if (!resource) return []
    const spec = resource.spec as Record<string, unknown> | undefined
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

  const statusColor = pod.statusText === 'Running' ? 'text-emerald-400'
    : (pod.statusText === 'Pending' || pod.statusText === 'NotReady') ? 'text-amber-400'
    : 'text-red-400'

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`font-modal text-[11.5px] font-semibold ${statusColor}`}>{pod.statusText}</span>
        <span className="font-modal text-[11px] text-muted-foreground/40">·</span>
        <span className="font-modal text-[11px] text-muted-foreground">{pod.phase}</span>
        <span className="font-modal text-[11px] text-muted-foreground/40">·</span>
        <span className="font-modal text-[11px] text-amber-400">↻ {pod.restarts} restart{pod.restarts !== 1 ? 's' : ''}</span>
      </div>

      <div>
        <h4 className="font-modal text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Metrics</h4>
        {loadingMetrics ? (
          <p className="font-modal text-[11px] text-muted-foreground/40">Loading metrics…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="CPU" unit="m" data={cpuData} color="#38bdf8" />
            <MetricCard label="Memory" unit="MiB" data={memData} color="#34d399" />
          </div>
        )}
      </div>

      <div>
        <h4 className="font-modal text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pod Details</h4>
        {loadingResource ? (
          <p className="font-modal text-[11px] text-muted-foreground/40">Loading…</p>
        ) : resource ? (
          <ResourceManifestOverview resource={resource} fields={podOverviewFields} title="" />
        ) : (
          <p className="font-modal text-[11px] text-muted-foreground/40">Could not load pod manifest.</p>
        )}
      </div>

      {containerPorts.length > 0 && (
        <PortForwardBadges namespace={pod.namespace} podName={pod.name} ports={containerPorts} />
      )}

      {resource && <LabelsSection resource={resource} />}
      {resource && <AnnotationsSection resource={resource} />}
    </div>
  )
}

// ─── Events Tab ───────────────────────────────────────────────────────────────

function EventsTab({ pod }: { pod: PodRow }) {
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const raw = await EventsGetResource(pod.namespace, pod.name)
        const list = Array.isArray(raw) ? raw
          : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
              ? ((raw as Record<string, unknown>).items as unknown[]) : [])
        if (!cancelled) setEvents(list as Array<Record<string, unknown>>)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'fetch error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [pod.namespace, pod.name])

  return <EventsTimeline events={events} loading={loading} error={error} />
}

// ─── Logs Tab ─────────────────────────────────────────────────────────────────

type ParsedPodLogLine = {
  lineClass: string
  containerLabel: string
  severityClass: string
  message: string
}


function decodeHtmlEntities(value: string): string {
  let decoded = value
  // Decode twice to handle payloads that arrive escaped as &amp;#34;.
  for (let i = 0; i < 2; i += 1) {
    decoded = decoded
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
  }
  return decoded.replace(/\t/g, '  ')
}

const POD_LOG_HTML_PATTERN = /<div class="([^"]+)"><span class="[^"]+">[\s\S]*?<\/span><span class="log-circle\s+([^"]+)"><\/span><span class="code">([\s\S]*?)<\/span><\/div>/i

function parsePodLogLine(html: string): ParsedPodLogLine {
  const match = html.match(POD_LOG_HTML_PATTERN)
  if (!match) {
    return {
      lineClass: 'log-line',
      containerLabel: '',
      severityClass: 'log-normal',
      message: decodeHtmlEntities(html.replace(/<[^>]+>/g, '')),
    }
  }

  return {
    lineClass: match[1] || 'log-line',
    containerLabel: '',
    severityClass: match[2] || 'log-normal',
    message: decodeHtmlEntities(match[3] || ''),
  }
}




// Replacement TypeScript functions to inject
// These replace getLogTokenClass + renderLogMessage with highlight.js equivalents

// Log level prefix colours – shown BEFORE any hljs processing
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

function highlightLogLine(message: string): string {
  // Strip any leading log-level prefix so hljs never sees it as an attr
  const levelMatch = message.match(LOG_LEVEL_RE)
  if (levelMatch) {
    const level   = levelMatch[1].toUpperCase()
    const sep     = levelMatch[2]
    const rest    = message.slice(levelMatch[0].length)
    const color   = LOG_LEVEL_COLORS[level] ?? '#94a3b8'
    const badgeHtml = `<span style="color:${color};font-weight:600">${level}</span><span style="color:#64748b">${sep}</span>`
    const bodyHtml  = rest ? highlightBody(rest) : ''
    return badgeHtml + bodyHtml
  }
  return highlightBody(message)
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

function applySearchHighlight(html: string, search: string): string {
  if (!search) return html
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'gi')
  return html.replace(/>([^<]*)</g, (_, text) =>
    '>' + text.replace(re, (m: string) => `<mark class="log-search-hit">${m}</mark>`) + '<'
  )
}


function getLogTone(severityClass: string, message: string): 'normal' | 'warning' | 'error' {
  const lower = message.toLowerCase()
  if (severityClass.includes('error') || /\b(error|err|fatal|panic|failed|exception|traceback)\b/.test(lower)) return 'error'
  if (severityClass.includes('warning') || /\b(warn|warning|timeout|deprecated|retrying)\b/.test(lower)) return 'warning'
  return 'normal'
}


function LogsTab({ pod }: { pod: PodRow }) {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [search, setSearch] = useState('')
  const [follow, setFollow] = useState(true)
  const [selectedContainer, setSelectedContainer] = useState(pod.primaryContainer)
  const logRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLines([])
    setError(null)
    setConnected(false)
    const ns = encodeURIComponent(pod.namespace)
    const name = encodeURIComponent(pod.name)
    const cname = encodeURIComponent(selectedContainer)
    const src = new BackendEventSource(`/resource/logs/pods/${ns}/${name}/${cname}`)

    src.addEventListener('log', (e: Event) => {
      if (cancelled) return
      setConnected(true)
      const msg = e as MessageEvent
      const html = String(msg.data ?? '').trim()
      if (html) setLines((prev) => {
        const next = [...prev, html]
        return next.length > 50 ? next.slice(-50) : next
      })
    })
    src.addEventListener('error', (e: Event) => {
      if (cancelled) return
      const msg = e as MessageEvent
      setError(String(msg.data ?? 'Stream error'))
    })
    src.onerror = () => {
      if (cancelled) return
      if (src.readyState === BackendEventSource.CLOSED) setError('Stream closed')
    }

    return () => {
      cancelled = true
      src.close()
    }
  }, [pod.namespace, pod.name, selectedContainer])

  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, follow])

  const containers = pod.containerStatuses?.length
    ? pod.containerStatuses.map((c) => c.name)
    : [pod.primaryContainer]

  const parsedLines = lines.map(parsePodLogLine)
  const filteredLines = search
    ? parsedLines.filter((line) => line.message.toLowerCase().includes(search.toLowerCase()) || line.containerLabel.toLowerCase().includes(search.toLowerCase()))
    : parsedLines

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-accent/10">
      <div className="px-3 py-1.5 border-b border-border/40 flex items-center gap-2 shrink-0 bg-accent/30 flex-wrap">
        <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        <div className="relative group">
          <select
            value={selectedContainer}
            onChange={(e) => setSelectedContainer(e.target.value)}
            className="log-viewer-select"
          >
            {containers.map((c) => (
              <option key={c} value={c} className="bg-accent/40">{c}</option>
            ))}
          </select>
        </div>
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
            <div key={i} className={`log-line ${line.lineClass} log-tone-${tone}`}>
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

// ─── Shell Tab ────────────────────────────────────────────────────────────────

type LegacyTerminalInstance = {
  rows: number
  cols: number
  loadAddon: (addon: unknown) => void
  open: (element: HTMLElement) => void
  write: (data: string | Uint8Array) => void
  onData: (cb: (data: string) => void) => void
  focus: () => void
  dispose: () => void
}

function ShellTab({ pod }: { pod: PodRow }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<LegacyTerminalInstance | null>(null)
  const fitAddonRef = useRef<{ fit: () => void } | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sessionError, setSessionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let offOutput: (() => void) | undefined
    let offStatus: (() => void) | undefined

    const bootTerminal = async () => {
      try {
        const { ensureLegacyTerminalAssets } = await import('./podLegacyAssets')
        await ensureLegacyTerminalAssets()
        if (cancelled || !hostRef.current) return

        const win = window as LegacyTerminalWindow & {
          Terminal?: new (options?: Record<string, unknown>) => LegacyTerminalInstance
          FitAddon?: { FitAddon: new () => { fit: () => void } }
        }
        if (!win.Terminal || !win.FitAddon) {
          throw new Error('xterm assets not loaded')
        }

        const term = new win.Terminal({
          cols: 120,
          rows: 40,
          cursorStyle: 'bar',
          cursorWidth: 2,
          cursorBlink: true,
          fontSize: 12,
          ignoreBracketedPasteMode: true,
          fontFamily: 'Monaco,Mono,Consolas,Liberation Mono,Menlo,monospace',
          theme: {
            foreground: '#cdd6f4',
            background: '#1e1e2e',
            cursor: '#f5c2e7',
            cursorAccent: '#1e1e2e',
            selectionBackground: '#45475a',
          },
        })

        const fitAddon = new win.FitAddon.FitAddon()
        term.loadAddon(fitAddon)
        term.open(hostRef.current)
        fitAddon.fit()
        term.focus()

        termRef.current = term
        fitAddonRef.current = fitAddon

        const sessionId = String((await StartPodShellSession(pod.namespace, pod.name, pod.primaryContainer)) ?? '').trim()
        if (!sessionId) throw new Error('backend did not return pod shell session id')
        sessionIdRef.current = sessionId

        offOutput = Events.On('podShellOutput', (ev) => {
          const payload = (ev?.data ?? {}) as { sessionId?: string; data?: string; enc?: string }
          if (payload.sessionId !== sessionIdRef.current) return
          const raw = payload.data ?? ''
          const decoded: string | Uint8Array = payload.enc === 'b64'
            ? Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
            : raw
          termRef.current?.write(decoded)
        })

        offStatus = Events.On('podShellStatus', (ev) => {
          const payload = (ev?.data ?? {}) as { sessionId?: string; status?: string; message?: string }
          if (payload.sessionId !== sessionIdRef.current) return
          if (payload.status === 'error') {
            const msg = String(payload.message ?? 'pod shell session error')
            setSessionError(msg)
            setStatus('error')
            uiNotify.error(`Shell access failed: ${msg}`)
          }
        })

        term.onData((data) => {
          const sid = sessionIdRef.current
          if (!sid) return
          void SendPodShellInput(sid, window.btoa(data))
        })

        const sendResize = () => {
          const sid = sessionIdRef.current
          const t = termRef.current
          if (!sid || !t) return
          void ResizePodShellSession(sid, t.rows, t.cols)
        }

        resizeObserverRef.current = new ResizeObserver(() => {
          fitAddonRef.current?.fit()
          sendResize()
        })
        if (hostRef.current) resizeObserverRef.current.observe(hostRef.current)

        window.setTimeout(() => {
          fitAddonRef.current?.fit()
          termRef.current?.focus()
          sendResize()
        }, 300)

        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'shell connection failed'
        setSessionError(msg)
        setStatus('error')
        uiNotify.error(`Shell access failed: ${msg}`)
      }
    }

    void bootTerminal()

    return () => {
      cancelled = true
      const sid = sessionIdRef.current
      if (sid) {
        void StopPodShellSession(sid)
        sessionIdRef.current = null
      }
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      offOutput?.()
      offStatus?.()
      fitAddonRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [pod.namespace, pod.name, pod.primaryContainer])

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {status === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="font-modal text-[11px] text-muted-foreground">Connecting to pod shell…</p>
        </div>
      )}
      {status === 'error' && (
        <div className="flex-1 flex items-center justify-center flex-col gap-2 p-4">
          <p className="font-modal text-[11px] text-red-400">Shell connection failed</p>
          {sessionError && <p className="font-modal text-[10px] text-muted-foreground/60 text-center max-w-sm">{sessionError}</p>}
        </div>
      )}
      <div ref={hostRef} className={`flex-1 overflow-hidden p-[5px] ${status !== 'ready' ? 'hidden' : ''}`} />
    </div>
  )
}

// ─── Edit Tab ─────────────────────────────────────────────────────────────────

function EditTab({ pod }: { pod: PodRow }) {
  const editorRef = useRef<LegacyAceEditor | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const originalRef = useRef<string>('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasSyntaxError, setHasSyntaxError] = useState(false)

  useEffect(() => {
    let destroyed = false
    const init = async () => {
      try {
        const { ensureLegacyEditorAssets } = await import('./podLegacyAssets')
        await ensureLegacyEditorAssets()
        const raw = await ResourceGetDetails('pods', pod.namespace, pod.name) as Record<string, unknown>
        const meta = { ...(raw.metadata as Record<string, unknown> | undefined) }
        delete meta['managedFields']
        const annotations = meta.annotations
        if (annotations && typeof annotations === 'object') {
          delete (annotations as Record<string, unknown>)['kubectl.kubernetes.io/last-applied-configuration']
        }
        const cleaned: Record<string, unknown> = { ...raw, metadata: meta }
        delete cleaned.status
        const win = window as LegacyEditorWindow
        const yaml = win.jsyaml?.dump(cleaned) || JSON.stringify(cleaned, null, 2)
        if (destroyed || !containerRef.current) return
        const editor = win.ace!.edit(containerRef.current)
        configureAceYamlEditor(editor, { onValidationChange: setHasSyntaxError })
        editor.setValue(yaml, -1)
        editor.getSession().getUndoManager().markClean()
        originalRef.current = yaml
        editor.getSession().on('change', () => {
          setDirty(!editor.getSession().getUndoManager().isClean())
        })
        editorRef.current = editor
        await new Promise<void>(r => requestAnimationFrame(() => r()))
        if (!destroyed) { editor.resize?.(); setLoading(false) }
      } catch (e) {
        if (!destroyed) setErr(e instanceof Error ? e.message : 'fetch error')
      }
    }
    void init()
    return () => {
      destroyed = true
      const editor = editorRef.current
      editorRef.current = null
      if (editor) { try { editor.destroy() } catch { /* ignore */ } }
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [pod.namespace, pod.name])

  const discard = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.setValue(originalRef.current, -1)
    editor.getSession().getUndoManager().markClean()
    setDirty(false)
  }

  const save = async () => {
    const editor = editorRef.current
    if (!editor) return
    if (hasSyntaxError) { setErr('YAML syntax error — fix before saving'); return }
    setSaving(true)
    setErr(null)
    try {
      const win = window as LegacyEditorWindow
      if (!win.jsyaml) throw new Error('YAML parser not available')
      const text = editor.getValue()
      const parsed = win.jsyaml.load(text)
      const clone = parsed && typeof parsed === 'object'
        ? (JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>)
        : ({} as Record<string, unknown>)
      delete clone.status
      const metadata = clone.metadata
      if (metadata && typeof metadata === 'object') {
        const meta = metadata as Record<string, unknown>
        delete meta.resourceVersion; delete meta.managedFields
        delete meta.uid; delete meta.creationTimestamp; delete meta.generation
      }
      await ResourceEdit('pods', pod.namespace, pod.name, JSON.stringify(clone))
      originalRef.current = text
      editor.getSession().getUndoManager().markClean()
      setDirty(false)
      uiNotify.success(`Pod ${pod.name} updated successfully`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'save failed'
      setErr(msg)
      uiNotify.error(`Save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {err && <p className="text-sm text-red-400">Error: {err}</p>}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span className="font-mono" />
        <span>{loading ? 'Loading…' : hasSyntaxError ? '⚠ YAML syntax error' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
      </div>

      <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden">
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/70">
            Loading YAML editor…
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={discard}
          disabled={loading || saving || !dirty}
          className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90"
        >
          Discard
        </button>
        <button
          onClick={() => void save()}
          disabled={loading || saving || !dirty || hasSyntaxError}
          className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({ icon, label, onClick, disabled = false, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-modal text-[11.5px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
               : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/60'
      }`}
    >
      {icon}{label}
    </button>
  )
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export function PodActionDrawer({ pod, initialTab = 'overview', onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [busy, setBusy] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  useEffect(() => { if (pod) setActiveTab(initialTab) }, [pod?.name, initialTab])
  useEffect(() => { if (!pod) { setConfirmDeleteOpen(false); setBusy(false) } }, [pod])

  const deletePod = async () => {
    if (!pod) return
    setBusy(true)
    try {
      await ResourceDelete('pods', pod.namespace, pod.name)
      uiNotify.success(`Deleted pod ${pod.name}`)
      onClose()
    } catch (err) {
      uiNotify.error(`Delete failed: ${err instanceof Error ? err.message : 'unknown'}`)
      setBusy(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Boxes size={13} /> },
    { id: 'events',   label: 'Events',   icon: <Radio size={13} /> },
    { id: 'logs',     label: 'Logs',     icon: <FileText size={13} /> },
    { id: 'shell',    label: 'Shell',    icon: <Terminal size={13} /> },
    { id: 'edit',     label: 'Edit YAML', icon: <Pencil size={13} /> },
  ]

  const visible = pod !== null
  const drawer = (
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[200] transition-opacity duration-200 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[760px] max-w-[100vw] z-[201] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Boxes size={15} className="text-primary shrink-0" />
              <span className="font-modal text-[15px] font-bold text-foreground truncate">{pod?.name}</span>
            </div>
            <p className="font-modal text-[11px] text-muted-foreground">
              <span className="text-cyan-400">{pod?.namespace}</span>
              <span className="mx-1.5 opacity-40">·</span>
              <span>{pod?.statusText}</span>
              <span className="mx-1.5 opacity-40">·</span>
              <span>{pod?.node}</span>
              <span className="mx-1.5 opacity-40">·</span>
              <span className="text-amber-400">↻ {pod?.restarts}</span>
            </p>
          </div>
          <UiTooltip content="Close panel" side="bottom">
            <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
              <X size={18} />
            </button>
          </UiTooltip>
        </div>

        <div className="flex items-center gap-0 border-b border-border bg-accent/10 px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 font-modal text-[11.5px] font-semibold border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-2 py-2">
            <ActionBtn icon={<Trash2 size={13} />} label="Delete" onClick={() => setConfirmDeleteOpen(true)} disabled={busy} danger />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {pod && activeTab === 'overview' && <OverviewTab pod={pod} />}
          {pod && activeTab === 'events'   && <EventsTab pod={pod} />}
          {pod && activeTab === 'logs'     && <LogsTab pod={pod} />}
          {pod && activeTab === 'shell'    && <ShellTab pod={pod} />}
          {pod && activeTab === 'edit'     && <EditTab pod={pod} />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete pod "${pod?.name ?? ''}"`}
        description={`This will delete the pod from namespace "${pod?.namespace ?? ''}".`}
        confirmLabel="Delete pod"
        onConfirm={() => { setConfirmDeleteOpen(false); window.setTimeout(() => { void deletePod() }, 0) }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(drawer, document.body)
}
