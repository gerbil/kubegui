/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Database,
  Lock,
  LockOpen,
  Radio,
  Shield,
  Terminal,
  Trash2,
  Wind,
} from 'lucide-react'
import { UiTooltip } from './UiTooltip'
import { uiNotify } from './UiNotify'
import { ResourceManifestOverview, LabelsSection, AnnotationsSection, EventsTimeline } from './ResourceManifestOverview'
import { nodeOverviewFields } from '../../features/resources/resourceOverview'

import React from "react"
import { Events } from '@wailsio/runtime'
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'
import {
  ResourceList,
  ResourceGetDetails,
  ResourceEdit,
  ResourceDelete,
  NodeCordon,
  NodeUncordon,
  EventsGetResource,
  NodeSetupShell,
  StartNodeShellSession,
  SendNodeShellInput,
  ResizeNodeShellSession,
  StopNodeShellSession,
  NodeGetMetricsByNameFromDB,
} from '../../../bindings/kubegui/services/backend'

type LegacyTerminalWindow = Window & typeof globalThis & {
  Terminal?: new (options?: Record<string, unknown>) => {
    rows: number
    cols: number
    loadAddon: (addon: unknown) => void
    open: (element: HTMLElement) => void
    write: (data: string | Uint8Array) => void
    onData: (cb: (data: string) => void) => void
    focus: () => void
    dispose: () => void
  }
  FitAddon?: {
    FitAddon: new () => {
      fit: () => void
    }
  }
}

type AceAnnotation = { type?: string }

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
  ace?: {
    edit: (el: HTMLElement | string) => LegacyAceEditor
  }
  jsyaml?: {
    dump: (value: unknown) => string
    load: (value: string) => unknown
  }
}

let legacyTerminalAssetsPromise: Promise<void> | null = null
let legacyEditorAssetsPromise: Promise<void> | null = null
const loadedLegacyScripts = new Set<string>()
const preparedNodeShell = new Set<string>()
const nodeShellSetupInFlight = new Map<string, Promise<void>>()

function scriptUrlCandidates(src: string): string[] {
  return [src]
}

function isLegacyScriptReady(src: string): boolean {
  const w = window as Window & typeof globalThis & {
    jQuery?: unknown
    $?: unknown
    ace?: unknown
    jsyaml?: unknown
  }
  if (src.includes('jquery.js')) return Boolean(w.jQuery || w.$)
  if (src.includes('ace.js')) return Boolean(w.ace)
  if (src.includes('js-yaml.js')) return Boolean(w.jsyaml)
  return false
}

function hasExistingLegacyScriptTag(src: string): boolean {
  const candidates = scriptUrlCandidates(src)
  const normalizePath = (raw: string) => {
    try {
      return new URL(raw, window.location.origin).pathname
    } catch {
      return raw
    }
  }
  const candidatePaths = new Set(candidates.map(normalizePath))

  for (const s of Array.from(document.scripts)) {
    const script = s as HTMLScriptElement
    const scriptSrc = script.getAttribute('src') || script.src
    if (!scriptSrc) continue
    if (candidatePaths.has(normalizePath(scriptSrc))) return true
  }

  return false
}

function loadLegacyScript(src: string) {
  const FETCH_TIMEOUT_MS = 15000

  const tryLoad = async (candidate: string) => {
    const injected = document.querySelector(`script[data-legacy-src="${src}"]`) as HTMLScriptElement | null
    if (injected) {
      injected.dataset.loaded = 'true'
      loadedLegacyScripts.add(src)
      return
    }

    // If the script already exists as a normal <script src="..."> tag, do not inject again.
    if (hasExistingLegacyScriptTag(src)) {
      loadedLegacyScripts.add(src)
      return
    }

    if (isLegacyScriptReady(src) || loadedLegacyScripts.has(src)) return

    const cacheBust = `_kg=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const url = candidate.includes('?') ? `${candidate}&${cacheBust}` : `${candidate}?${cacheBust}`

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let code = ''

    try {
      // Static frontend assets should bypass backend bridge route dispatch.
      const res = await window.fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      code = await res.text()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      if (msg.toLowerCase().includes('aborted')) {
        throw new Error(`Timed out loading ${candidate}`)
      }
      throw new Error(`Failed to load ${candidate}: ${msg}`)
    } finally {
      window.clearTimeout(timeout)
    }

    if (!code.trim()) {
      throw new Error(`Failed to load ${candidate}: empty response`)
    }

    // Inject source text directly to avoid relying on dynamic script load events.
    const script = document.createElement('script')
    script.dataset.loaded = 'true'
    script.dataset.legacySrc = src
    script.text = `${code}\n//# sourceURL=${candidate}`
    document.head.appendChild(script)

    if (isLegacyScriptReady(src)) {
      loadedLegacyScripts.add(src)
      return
    }

    // For libs without reliable window markers, treat successful injection as loaded.
    if (!src.includes('jquery.js') && !src.includes('ace.js') && !src.includes('js-yaml.js')) {
      loadedLegacyScripts.add(src)
      return
    }

    throw new Error(`Failed to initialize ${candidate} after injection`)
  }

  return (async () => {
    let lastErr: Error | null = null
    for (const candidate of scriptUrlCandidates(src)) {
      try {
        await tryLoad(candidate)
        return
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(`Failed to load ${candidate}`)
      }
    }
    throw lastErr ?? new Error(`Failed to load ${src}`)
  })()
}

function ensureLegacyTerminalAssets() {
  if (legacyTerminalAssetsPromise) return legacyTerminalAssetsPromise

  legacyTerminalAssetsPromise = (async () => {
    const cssHref = '/assets/css/xterm.css'
    if (!document.querySelector(`link[href="${cssHref}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = cssHref
      document.head.appendChild(link)
    }

    await loadLegacyScript('/assets/js/jquery.js')
    await loadLegacyScript('/assets/js/xterm.js')
    await loadLegacyScript('/assets/js/xterm-addon-fit.js')
    await loadLegacyScript('/assets/js/xterm-addon-clipboard.js')
    await loadLegacyScript('/assets/js/xterm-global.js')
  })()

  legacyTerminalAssetsPromise.catch(() => {
    legacyTerminalAssetsPromise = null
  })

  return legacyTerminalAssetsPromise
}

function ensureLegacyEditorAssets() {
  if (legacyEditorAssetsPromise) return legacyEditorAssetsPromise

  legacyEditorAssetsPromise = (async () => {
    await loadLegacyScript('/assets/js/ace.js')
    await loadLegacyScript('/assets/js/ace-ext-language-tools.js')
    await loadLegacyScript('/assets/js/ace-mode-yaml.js')
    await loadLegacyScript('/assets/js/theme-solarized_dark.js')
    await loadLegacyScript('/assets/js/js-yaml.js')
  })()

  legacyEditorAssetsPromise.catch(() => {
    legacyEditorAssetsPromise = null
  })

  return legacyEditorAssetsPromise
}


// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeActionTarget = {
  name: string
  ip: string
  instanceType: string
  cpu: number
  ram: number
  disk: number
  pods: number
  cordoned: boolean
  drained: boolean
}

type Tab = 'overview' | 'events' | 'shell' | 'edit'

interface Props {
  node: NodeActionTarget | null
  initialTab?: Tab
  runNodeAction?: (options: { label: string; url: string; method?: string; successMessage?: string; errorMessage?: string }) => Promise<boolean>
  onClose: () => void
  onCordonChange?: (name: string, cordoned: boolean) => void
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: `${color}20`, color }}
    >
      {children}
    </span>
  )
}


async function fetchNodeResourceByName(name: string): Promise<Record<string, unknown>> {
  // Use generic ResourceGetDetails (dynamic client).
  try {
    const obj = await ResourceGetDetails('nodes', '', name)
    if (obj && typeof obj === 'object' && (obj as Record<string, unknown>).metadata) {
      return obj as Record<string, unknown>
    }
  } catch { /* fallback to list */ }

  // Last resort: find from the resource list.
  const data = await ResourceList('nodes', '')
  const items = Array.isArray(data) ? data : []
  const match = items.find((item) => {
    if (!item || typeof item !== 'object') return false
    const metadata = (item as Record<string, unknown>).metadata
    return metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>).name === name
  })
  if (!match) throw new Error(`Node ${name} not found`)
  return match as Record<string, unknown>
}

function cleanNodeForEdit(resource: Record<string, unknown>): Record<string, unknown> {
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

// ─── Live usage sparkline ─────────────────────────────────────────────────────

function CombinedGraph({
  cpu, ram, disk,
  height = 90,
}: {
  cpu: number[]
  ram: number[]
  disk: number[]
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(240)
  const [hovered, setHovered] = useState<{ x: number; y: number; i: number } | null>(null)

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

  const series = [
    { data: cpu,  color: '#38bdf8', label: 'CPU'  },
    { data: ram,  color: '#34d399', label: 'RAM'  },
    { data: disk, color: '#a78bfa', label: 'Disk' },
  ]

  const maxLen = Math.max(...series.map((s) => s.data.length))
  if (maxLen < 1) {
    return (
      <div ref={containerRef} style={{ height }} className="w-full flex items-center justify-center">
        <span className="text-[9px] text-muted-foreground/30">collecting…</span>
      </div>
    )
  }

  const padT = 6, padB = 16, padL = 24, padR = 8
  const gw = width - padL - padR
  const gh = height - padT - padB

  const toX = (i: number, len: number) => (len <= 1 ? padL + gw / 2 : padL + (i / (len - 1)) * gw)
  const toY = (v: number) => padT + gh - (Math.min(100, Math.max(0, v)) / 100) * gh

  const gridLines = [25, 50, 75, 100]

  // tooltip box dimensions
  const ttW = 88, ttH = 52, ttPad = 6

  return (
    <div ref={containerRef} className="w-full">
    <svg
      width={width} height={height}
      className="overflow-visible shrink-0"
      onMouseLeave={() => setHovered(null)}
    >
      <defs>
        {series.map((s) => (
          <linearGradient key={s.label} id={`cg-${s.label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={s.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
          </linearGradient>
        ))}
      </defs>

      {/* Grid */}
      {gridLines.map((v) => (
        <g key={v}>
          <line x1={padL} y1={toY(v)} x2={padL + gw} y2={toY(v)} stroke="#ffffff" strokeOpacity="0.04" strokeWidth="1" />
          <text x={padL - 3} y={toY(v) + 3} fontSize="7" fill="#ffffff" fillOpacity="0.2" textAnchor="end">{v}%</text>
        </g>
      ))}
      <line x1={padL} y1={padT + gh} x2={padL + gw} y2={padT + gh} stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" />

      {/* Series */}
      {series.map((s) => {
        if (s.data.length < 1) return null
        if (s.data.length === 1) {
          const x = toX(0, 1)
          const y = toY(s.data[0])
          return (
            <g key={s.label}>
              <circle cx={x} cy={y} r="2.5" fill={s.color} opacity="0.95" />
              <circle cx={x} cy={y} r="5" fill={s.color} opacity="0.12" />
            </g>
          )
        }
        const areaPts = [
          `${toX(0, s.data.length)},${padT + gh}`,
          ...s.data.map((v, i) => `${toX(i, s.data.length)},${toY(v)}`),
          `${toX(s.data.length - 1, s.data.length)},${padT + gh}`,
        ].join(' ')
        const linePts = s.data.map((v, i) => `${toX(i, s.data.length)},${toY(v)}`).join(' ')
        const lx = toX(s.data.length - 1, s.data.length)
        const ly = toY(s.data[s.data.length - 1])
        return (
          <g key={s.label}>
            <polygon points={areaPts} fill={`url(#cg-${s.label})`} />
            <polyline points={linePts} fill="none" stroke={s.color} strokeWidth="1.5"
              strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
            <circle cx={lx} cy={ly} r="2.5" fill={s.color} opacity="0.95" />
            <circle cx={lx} cy={ly} r="5"   fill={s.color} opacity="0.12" />
          </g>
        )
      })}

      {/* Invisible hit-zones per sample index (using longest series) */}
      {Array.from({ length: maxLen }).map((_, i) => {
        const x = toX(i, maxLen)
        return (
          <rect
            key={i}
            x={x - gw / maxLen / 2}
            y={padT}
            width={gw / maxLen}
            height={gh}
            fill="transparent"
            onMouseEnter={() => setHovered({ x, y: padT, i })}
          />
        )
      })}

      {/* Hover crosshair + tooltip */}
      {hovered && (() => {
        const i = hovered.i
        const cpuV  = cpu[Math.min(i,  cpu.length  - 1)] ?? 0
        const ramV  = ram[Math.min(i,  ram.length  - 1)] ?? 0
        const diskV = disk[Math.min(i, disk.length - 1)] ?? 0
        const cx = hovered.x
        // flip tooltip left if too close to right edge
        const ttX = cx + ttPad + ttW > width ? cx - ttPad - ttW : cx + ttPad
        const ttY = padT
        return (
          <g pointerEvents="none">
            {/* crosshair */}
            <line x1={cx} y1={padT} x2={cx} y2={padT + gh} stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="3 2" />
            {/* dots per series at this sample */}
            {[
              { v: cpuV,  c: '#38bdf8' },
              { v: ramV,  c: '#34d399' },
              { v: diskV, c: '#a78bfa' },
            ].map(({ v, c }) => (
              <circle key={c} cx={cx} cy={toY(v)} r="3" fill={c} stroke="#0f172a" strokeWidth="1" opacity="0.95" />
            ))}
            {/* tooltip box */}
            <rect x={ttX} y={ttY} width={ttW} height={ttH} rx="4" fill="#0f172a" stroke="#334155" strokeWidth="0.8" opacity="0.95" />
            <text x={ttX + 6} y={ttY + 12} fontSize="7.5" fill="#94a3b8" fontFamily="monospace">
              sample {i + 1}/{maxLen}
            </text>
            {[
              { label: 'CPU',  v: cpuV,  c: '#38bdf8', dy: 23 },
              { label: 'RAM',  v: ramV,  c: '#34d399', dy: 34 },
              { label: 'Disk', v: diskV, c: '#a78bfa', dy: 45 },
            ].map(({ label, v, c, dy }) => (
              <g key={label}>
                <rect x={ttX + 6} y={ttY + dy - 6} width="6" height="6" rx="1" fill={c} opacity="0.85" />
                <text x={ttX + 15} y={ttY + dy} fontSize="8" fill={c} fontFamily="monospace">
                  {label} {v.toFixed(1)}%
                </text>
              </g>
            ))}
          </g>
        )
      })()}

      {/* Legend */}
      {series.map((s, i) => {
        const latest = s.data[s.data.length - 1] ?? 0
        return (
          <g key={s.label} transform={`translate(${padL + i * (gw / 3)}, ${height})`}>
            <rect x="0" y="-9" width="6" height="6" rx="1" fill={s.color} opacity="0.8" />
            <text x="8" y="-3" fontSize="7.5" fill={s.color} fillOpacity="0.85" fontFamily="monospace">
              {s.label} {latest.toFixed(1)}%
            </text>
          </g>
        )
      })}
    </svg>
    </div>
  )
}

function LiveBar({
  label, value, color, unit = 'pct',
}: {
  label: string; value: number; color: string; unit?: 'pct' | 'gib'
}) {
  const display = unit === 'gib' ? `${value.toFixed(1)} GiB` : `${value.toFixed(1)}%`
  const barPct  = unit === 'gib' ? Math.min(100, (value / 128) * 100) : Math.min(100, value) // rough 128 GiB max for bar
  return (
    <div className="flex items-center gap-3.5">
      <span className="font-modal text-[11px] uppercase tracking-wider text-muted-foreground/60 w-10 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${barPct}%`, background: color }}
        />
      </div>
      <span className="text-[11px] font-mono w-16 text-right shrink-0" style={{ color }}>
        {display}
      </span>
    </div>
  )
}

function LiveUsageSection({ nodeName }: { nodeName: string }) {
  const [metrics, setMetrics] = useState<import('../../../bindings/kubegui/internal/metricsscraper/models').NodeMetrics[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    NodeGetMetricsByNameFromDB(nodeName)
      .then((rows) => {
        if (!cancelled) {
          setMetrics(rows ?? [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [nodeName])

  const latest = metrics[metrics.length - 1]
  const cpuHistory  = metrics.map((r) => r.Cpu)
  const ramHistory  = metrics.map((r) => r.Memory)
  const diskHistory = metrics.map((r) => r.Disk)

  return (
    <div className="rounded-xl border border-border/60 bg-accent/15 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="font-modal text-[11px] uppercase tracking-wider text-muted-foreground">Live Usage</p>
        {metrics.length > 0 && (
              <span className="flex items-center gap-1.5 text-[9px] text-emerald-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Recent · 1m
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] text-muted-foreground/50">Loading metrics…</p>
      ) : metrics.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/50">Collecting metrics…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-5">
            <div className="w-1/2 space-y-3 shrink-0">
              <LiveBar label="CPU"  value={latest?.Cpu    ?? 0} color="#38bdf8" unit="pct" />
              <LiveBar label="RAM"  value={latest?.Memory ?? 0} color="#34d399" unit="pct" />
              <LiveBar label="Disk" value={latest?.Disk   ?? 0} color="#a78bfa" unit="pct" />
            </div>
            <div className="w-1/2 min-w-0">
              <CombinedGraph cpu={cpuHistory} ram={ramHistory} disk={diskHistory} height={124} />
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground/40 text-right">{metrics.length} samples · 5s interval</p>
        </div>
      )}
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseMemoryKi(s: string | undefined): number {
  if (!s) return 0
  if (s.endsWith('Ki')) return parseInt(s) / (1024 * 1024)
  if (s.endsWith('Mi')) return parseInt(s) / 1024
  if (s.endsWith('Gi')) return parseFloat(s)
  return parseInt(s) / (1024 * 1024 * 1024)
}

function fmtGiB(n: number) { return n >= 1 ? `${n.toFixed(1)} GiB` : `${(n * 1024).toFixed(0)} MiB` }

function CapCard({ label, value, unit, color }: { label: string; value: string; unit: 'cpu' | 'mem' | 'pods'; color: string }) {
  let displayValue: string
  if (unit === 'mem') {
    const num = parseMemoryKi(value)
    displayValue = fmtGiB(num)
  } else {
    displayValue = value
  }
  return (
    <div className="flex-1 min-w-[100px] rounded-lg border border-border bg-accent/20 p-3 space-y-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <span className="text-2xl font-bold font-mono leading-none" style={{ color }}>{displayValue}</span>
    </div>
  )
}

function TaintBadge({ taint }: { taint: Record<string, unknown> }) {
  const key    = String(taint.key    ?? '')
  const value  = String(taint.value  ?? '')
  const effect = String(taint.effect ?? '')
  const color  = effect === 'NoExecute' ? '#ef4444' : effect === 'NoSchedule' ? '#f59e0b' : '#a78bfa'
  return (
    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono border"
      style={{ borderColor: `${color}50`, background: `${color}15`, color }}>
      {key}{value ? `=${value}` : ''}<span className="opacity-60">:{effect}</span>
    </span>
  )
}

// ─── OverviewTab ──────────────────────────────────────────────────────────────

function OverviewTab({
  node,
}: {
  node: NodeActionTarget
}) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setErr(null)
    fetchNodeResourceByName(node.name)
      .then((d) => { setDetails(d); setLoading(false) })
      .catch((e: unknown) => { setErr(e instanceof Error ? e.message : 'fetch error'); setLoading(false) })
  }, [node.name])

  if (loading) return <p className="font-modal text-[11.5px] text-muted-foreground p-4">Loading node details…</p>
  if (err)     return <p className="font-modal text-[11.5px] text-red-400 p-4">Error: {err}</p>

  const spec       = details?.spec     as Record<string, unknown> | undefined
  const status     = details?.status   as Record<string, unknown> | undefined
  const capacity   = status?.capacity   as Record<string, string> | undefined
  const nodeInfo   = status?.nodeInfo   as Record<string, string> | undefined
  const conditions = (status?.conditions as Array<Record<string, unknown>> | undefined) ?? []
  const taints     = (spec?.taints      as Array<Record<string, unknown>> | undefined) ?? []

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">

      {/* ── Node Details (structured field table) ── */}
      {details && (
        <ResourceManifestOverview
          resource={details}
          fields={nodeOverviewFields}
          title="Node Details"
          hideEmpty
        />
      )}

      {/* ── Capacity ── */}
      {capacity && (
        <div>
          <p className="font-modal text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Node Capacity</p>
          <div className="flex gap-2 flex-wrap">
            <CapCard label="CPU"    value={capacity.cpu    ?? '0'} unit="cpu"  color="#38bdf8" />
            <CapCard label="Memory" value={capacity.memory ?? '0'} unit="mem"  color="#34d399" />
            <CapCard label="Pods"   value={capacity.pods   ?? '0'} unit="pods" color="#a78bfa" />
          </div>
        </div>
      )}

      {/* ── Live Usage ── */}
      <LiveUsageSection nodeName={node.name} />

      {/* ── Taints ── */}
      {taints.length > 0 && (
        <div>
          <p className="font-modal text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Taints</p>
          <div className="flex flex-wrap gap-1.5">
            {taints.map((t, i) => <TaintBadge key={i} taint={t} />)}
          </div>
        </div>
      )}

      {/* ── Node Info ── */}
      {nodeInfo && (
        <div>
          <p className="font-modal text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Node Info</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {([
              ['Architecture',     nodeInfo.architecture],
              ['OS Image',         nodeInfo.osImage],
              ['Kernel',           nodeInfo.kernelVersion],
              ['Container Runtime',nodeInfo.containerRuntimeVersion],
              ['Kubelet',          nodeInfo.kubeletVersion],
              ['Kube-Proxy',       nodeInfo.kubeProxyVersion],
            ] as [string, string][]).map(([k, v]) => v && (
              <div key={k} className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{k}</span>
                <span className="font-modal text-[11.5px] text-foreground truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Conditions ── */}
      {conditions.length > 0 && (
        <div>
          <p className="font-modal text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Conditions</p>
          <div className="flex flex-wrap gap-1.5">
            {conditions.map((c, i) => {
              const t = String(c.type ?? '') || 'Condition'
              const s = String(c.status ?? 'Unknown')
              const sLower = s.toLowerCase()
              const isReady = t === 'Ready'
              const color =
                sLower === 'unknown'
                  ? '#f59e0b'
                  : isReady
                    ? (sLower === 'true' ? '#10b981' : '#ef4444')
                    : (sLower === 'false' ? '#10b981' : '#ef4444')
              return <Badge key={`${t}-${i}`} color={color}>{t}</Badge>
            })}
          </div>
        </div>
      )}


      {/* ── Labels ── */}
      {details && <LabelsSection resource={details} />}

      {/* ── Annotations ── */}
      {details && <AnnotationsSection resource={details} />}
    </div>
  )
}

function EventsTab({ node }: { node: NodeActionTarget }) {
  type KubeEvent = { message: string; reason: string; type: string; time?: string; lastTimestamp?: string; eventTime?: string }
  const [events, setEvents] = useState<KubeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setErr(null)
    EventsGetResource('', '')
      .then((res) => {
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`Node events failed (HTTP ${res.status}): ${res.body}`)
        }
        const raw = res.body ? (JSON.parse(res.body) as unknown) : []
        const list = Array.isArray(raw)
          ? raw
          : (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
              ? (raw as Record<string, unknown>).items as unknown[]
              : [])
        const nodeEvents = list.filter((item) => {
          if (!item || typeof item !== 'object') return false
          const obj = item as Record<string, unknown>
          const involved = obj.involvedObject as Record<string, unknown> | undefined
          const regarding = obj.regarding as Record<string, unknown> | undefined
          const kind = String(involved?.kind ?? regarding?.kind ?? '')
          const name = String(involved?.name ?? regarding?.name ?? '')
          return kind.toLowerCase() === 'node' && name === node.name
        })
        setEvents(nodeEvents as KubeEvent[])
        setLoading(false)
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : 'fetch error')
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [node.name])

  if (loading) return <p className="font-modal text-[11.5px] text-muted-foreground p-4">Loading events…</p>
  if (err) return <p className="font-modal text-[11.5px] text-red-400 p-4">Error: {err}</p>

  return <EventsTimeline events={events as Record<string, unknown>[]} error={null} />
}

function ShellTab({ node }: { node: NodeActionTarget }) {
  const [status, setStatus] = useState<'preparing' | 'ready' | 'error'>('preparing')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<InstanceType<NonNullable<LegacyTerminalWindow['Terminal']>> | null>(null)
  const fitAddonRef = useRef<{ fit: () => void } | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const toUserShellError = (raw: string) => {
    const msg = raw.toLowerCase()
    if (
      msg.includes('forbidden') ||
      msg.includes('cannot create resource "daemonsets"') ||
      msg.includes('no permissions') ||
      msg.includes('permission denied')
    ) {
      return 'Kubernetes user has no permissions to start the debug DaemonSet required for node shell access.'
    }
    return raw
  }


  useEffect(() => {
    const win = window as LegacyTerminalWindow
    let cancelled = false
    let offOutput: (() => void) | null = null
    let offStatus: (() => void) | null = null

    setStatus('preparing')
    setSessionError(null)

    const bootTerminal = async () => {
      try {
        uiNotify.info(`We will install debug daemon set for you on ${node.name}`)
        await ensureLegacyTerminalAssets()
        if (cancelled) return

        if (!hostRef.current || !win.Terminal || !win.FitAddon?.FitAddon) {
          throw new Error('Legacy terminal runtime is not available')
        }

        hostRef.current.innerHTML = ''
        const term = new win.Terminal({
          cols: 120,
          rows: 60,
          cursorStyle: 'bar',
          cursorWidth: 2,
          cursorBlink: true,
          fontSize: 12,
          ignoreBracketedPasteMode: true,
          fontFamily: "Monaco,Mono,Consolas,Liberation Mono,Menlo,monospace",
          theme: {
            foreground: '#cdd6f4',
            background: '#1e1e2e',
            cursor: '#f5c2e7',
            cursorAccent: '#1e1e2e',
            selectionBackground: '#45475a',
            black: '#45475a',
            red: '#f38ba8',
            green: '#a6e3a1',
            yellow: '#f9e2af',
            blue: '#89b4fa',
            magenta: '#f5c2e7',
            cyan: '#94e2d5',
            white: '#bac2de',
            brightBlack: '#585b70',
            brightRed: '#f38ba8',
            brightGreen: '#a6e3a1',
            brightYellow: '#f9e2af',
            brightBlue: '#89b4fa',
            brightMagenta: '#f5c2e7',
            brightCyan: '#94e2d5',
            brightWhite: '#a6adc8',
          },
        }) as InstanceType<NonNullable<LegacyTerminalWindow['Terminal']>>

        const fitAddon = new win.FitAddon.FitAddon()
        term.loadAddon(fitAddon)
        term.open(hostRef.current)
        fitAddon.fit()
        term.focus()

        termRef.current = term
        fitAddonRef.current = fitAddon

        const setupKey = node.name
        if (!preparedNodeShell.has(setupKey)) {
          let setupPromise = nodeShellSetupInFlight.get(setupKey)
          if (!setupPromise) {
            setupPromise = (async () => {
              await NodeSetupShell(node.name)
              preparedNodeShell.add(setupKey)
            })().finally(() => {
              nodeShellSetupInFlight.delete(setupKey)
            })
            nodeShellSetupInFlight.set(setupKey, setupPromise)
          }
          await setupPromise
          if (cancelled) return
        }

        const sessionId = String((await StartNodeShellSession(node.name)) ?? '').trim()
        if (!sessionId) throw new Error('backend did not return shell session id')
        sessionIdRef.current = sessionId

        offOutput = Events.On('nodeShellOutput', (ev) => {
          const payload = (ev?.data ?? {}) as { sessionId?: string; data?: string; enc?: string }
          if (payload.sessionId !== sessionIdRef.current) return
          const raw = payload.data ?? ''
          // Server always base64-encodes binary output (enc: 'b64') so that
          // arbitrary bytes survive JSON serialisation intact.
          const decoded: string | Uint8Array = payload.enc === 'b64'
            ? Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
            : raw
          termRef.current?.write(decoded)
        })

        offStatus = Events.On('nodeShellStatus', (ev) => {
          const payload = (ev?.data ?? {}) as { sessionId?: string; status?: string; message?: string }
          if (payload.sessionId !== sessionIdRef.current) return
          if (payload.status === 'error') {
            const msg = toUserShellError(String(payload.message ?? 'shell session error'))
            setSessionError(msg)
            setStatus('error')
            uiNotify.error(`Shell access failed: ${msg}`)
          }
        })

        term.onData((data) => {
          const sid = sessionIdRef.current
          if (!sid) return
          const encoded = window.btoa(data)
          void SendNodeShellInput(sid, encoded)
        })

        const sendResize = () => {
          const sid = sessionIdRef.current
          if (!sid) return
          const term = termRef.current
          if (!term) return
          // Use the terminal's own authoritative row/col count (set by FitAddon).
          void ResizeNodeShellSession(sid, term.rows, term.cols)
        }

        resizeObserverRef.current = new ResizeObserver(() => {
          fitAddonRef.current?.fit()
          sendResize()
        })
        resizeObserverRef.current.observe(hostRef.current)

        // Delay the first fit+resize so the container has settled (CSS animations,
        // drawer opening, etc.) and the remote PTY gets the correct size from the start.
        window.setTimeout(() => {
          fitAddonRef.current?.fit()
          termRef.current?.focus()
          sendResize()
        }, 300)

        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        const rawMsg = e instanceof Error ? e.message : 'shell connection failed'
        const msg = toUserShellError(rawMsg)
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
        void StopNodeShellSession(sid)
        sessionIdRef.current = null
      }
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      offOutput?.()
      offStatus?.()
      fitAddonRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      if (hostRef.current) {
        hostRef.current.innerHTML = ''
      }
    }
  }, [node.name])

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-mono">Node shell via debug daemon set</span>
        {status === 'preparing' && <span className="text-amber-400">Preparing…</span>}
        {status === 'ready' && <span className="text-emerald-400">Connected</span>}
        {status === 'error' && <span className="text-red-400">Failed</span>}
      </div>
      {sessionError && (
        <p className="font-modal text-[11.5px] text-red-400">Error: {sessionError}</p>
      )}
      <div className="relative flex-1 min-h-0 overflow-hidden rounded border border-border bg-[#0d1117]" style={{ padding: '5px' }}>
        <div ref={hostRef} className="h-full w-full" onMouseDown={() => termRef.current?.focus()} />
        {status === 'preparing' && (
          <div className="absolute inset-0 flex h-full items-center justify-center font-modal text-[11.5px] text-muted-foreground bg-background/50">
            Preparing node shell…
          </div>
        )}
      </div>
    </div>
  )
}

function EditTab({ node }: { node: NodeActionTarget }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<LegacyAceEditor | null>(null)
  const baselineYamlRef = useRef('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [hasSyntaxError, setHasSyntaxError] = useState(false)

  const refreshEditorFlags = () => {
    const editor = editorRef.current
    if (!editor) return
    const session = editor.getSession()
    const annotations = session.getAnnotations() || []
    const syntaxError = annotations.some((a) => a?.type === 'error')
    setHasSyntaxError(syntaxError)
    setDirty(!session.getUndoManager().isClean())
  }

  useEffect(() => {
    let cancelled = false

    const setup = async () => {
      setLoading(true)
      setSaving(false)
      setDirty(false)
      setHasSyntaxError(false)

      try {
        await ensureLegacyEditorAssets()
        if (cancelled) return

        const win = window as LegacyEditorWindow
        if (!hostRef.current || !win.ace || !win.jsyaml) {
          throw new Error('Legacy YAML editor runtime is not available')
        }

        const editor = win.ace.edit(hostRef.current)
        editorRef.current = editor

        configureAceYamlEditor(editor)

        let json: unknown
        try {
          json = await ResourceGetDetails('nodes', '', node.name)
        } catch {
          json = await fetchNodeResourceByName(node.name)
        }
        const yamlText = win.jsyaml.dump(cleanNodeForEdit(json as Record<string, unknown>))

        if (cancelled) return

        baselineYamlRef.current = yamlText
        editor.setValue(yamlText, -1)
        editor.getSession().getUndoManager().markClean()

        editor.on('input', refreshEditorFlags)
        editor.getSession().on('changeAnnotation', refreshEditorFlags)
        editor.resize?.()
        refreshEditorFlags()
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'editor setup failed'
        uiNotify.error(`Failed to load node YAML editor: ${msg}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void setup()

    return () => {
      cancelled = true
      const editor = editorRef.current
      editorRef.current = null
      if (editor) {
        editor.destroy()
      }
      if (hostRef.current) {
        hostRef.current.innerHTML = ''
      }
    }
  }, [node.name])

  const save = async () => {
    const editor = editorRef.current
    if (!editor) return
    if (hasSyntaxError) {
      uiNotify.error('YAML validation failed. Fix editor errors before saving.')
      return
    }

    setSaving(true)
    uiNotify.info(`Saving node ${node.name} YAML...`)

    try {
      const win = window as LegacyEditorWindow
      if (!win.jsyaml) throw new Error('YAML parser is not available')

      const yamlText = editor.getValue()
      const parsedPatch = win.jsyaml.load(yamlText)
      const patchObj = (() => {
        const clone = parsedPatch && typeof parsedPatch === 'object'
          ? (JSON.parse(JSON.stringify(parsedPatch)) as Record<string, unknown>)
          : ({} as Record<string, unknown>)

        // Nodes are updated frequently, so stale volatile fields cause conflict errors.
        delete clone.status
        const metadata = clone.metadata
        if (metadata && typeof metadata === 'object') {
          const meta = metadata as Record<string, unknown>
          delete meta.resourceVersion
          delete meta.managedFields
          delete meta.uid
          delete meta.creationTimestamp
          delete meta.generation
        }

        return clone
      })()

      const savePatch = async () => {
        await ResourceEdit('nodes', '', node.name, JSON.stringify(patchObj))
      }

      try {
        await savePatch()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const conflict = /object has been modified|operation cannot be fulfilled/i.test(msg)
        if (!conflict) throw e
        uiNotify.info('Node changed on cluster, retrying save...')
        await new Promise((resolve) => window.setTimeout(resolve, 150))
        await savePatch()
      }

      baselineYamlRef.current = yamlText
      editor.getSession().getUndoManager().markClean()
      refreshEditorFlags()
      uiNotify.success(`Node ${node.name} updated successfully`)
    } catch (e) {
      uiNotify.error(`YAML save failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.setValue(baselineYamlRef.current, -1)
    editor.getSession().getUndoManager().markClean()
    refreshEditorFlags()
  }



  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span className="font-mono" />
        <span>{loading ? 'Loading…' : hasSyntaxError ? '⚠ YAML syntax error' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
      </div>
      <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden">
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center font-modal text-[11.5px] text-muted-foreground bg-background/70">
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

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export function NodeActionDrawer({ node, initialTab = 'overview', runNodeAction, onClose, onCordonChange }: Props) {
  const resolveInitialTab = (tab: Tab): Tab => (tab === 'shell' ? 'overview' : tab)
  const [activeTab, setActiveTab] = useState<Tab>(() => resolveInitialTab(initialTab))
  const [busy, setBusy] = useState(false)

  // Reset tab when node changes
  useEffect(() => {
    if (!node) return
    setActiveTab(resolveInitialTab(initialTab))
  }, [node?.name, initialTab])

  // Do not keep an off-screen drawer mounted; it can create horizontal overflow.
  if (!node) return null

  const cordon = async () => {
    if (!node) return
    setBusy(true)
    try {
      if (runNodeAction) {
        const ok = await runNodeAction({ label: `Cordon node ${node.name}`, url: '' })
        if (!ok) throw new Error('request failed')
      } else {
        await NodeCordon(node.name)
        uiNotify.success(`Cordon in progress: ${node.name}`)
      }
      onCordonChange?.(node.name, true)
    } catch (e) {
      uiNotify.error(`Cordon failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally { setBusy(false) }
  }

  const uncordon = async () => {
    if (!node) return
    setBusy(true)
    try {
      if (runNodeAction) {
        const ok = await runNodeAction({ label: `Uncordon node ${node.name}`, url: '' })
        if (!ok) throw new Error('request failed')
      } else {
        await NodeUncordon(node.name)
        uiNotify.success(`Uncordon in progress: ${node.name}`)
      }
      onCordonChange?.(node.name, false)
    } catch (e) {
      uiNotify.error(`Uncordon failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally { setBusy(false) }
  }

  const drain = async () => {
    if (!node) return
    if (!window.confirm(`Drain node "${node.name}"? All pods will be evicted.`)) return
    uiNotify.info('Node drain is not yet implemented')
  }

  const deleteNode = async () => {
    if (!node) return
    if (!window.confirm(`Delete node "${node.name}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      await ResourceDelete('nodes', '', node.name)
      uiNotify.success(`Delete in progress: ${node.name}`)
      onClose()
    } catch (e) {
      uiNotify.error(`Delete failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally { setBusy(false) }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Database size={13} /> },
    { id: 'events', label: 'Events', icon: <Radio size={13} /> },
    { id: 'shell', label: 'Shell', icon: <Terminal size={13} /> },
    { id: 'edit', label: 'Edit YAML', icon: <Shield size={13} /> },
  ]

  const drawer = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[999] transition-opacity duration-200 opacity-100 pointer-events-auto"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[760px] max-w-[100vw] z-[1000] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out translate-x-0"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Database size={15} className="text-primary shrink-0" />
              <span className="font-modal text-[15px] font-bold text-foreground truncate">{node?.name}</span>
              {node?.cordoned && <Badge color="#f59e0b"><Lock size={9} /> Cordoned</Badge>}
              {node?.drained && <Badge color="#10b981"><Wind size={9} /> Drained</Badge>}
            </div>
            <p className="font-modal text-[11px] text-muted-foreground">
              {node?.ip} &nbsp;·&nbsp; {node?.instanceType} &nbsp;·&nbsp;
              <span className="text-cyan-400">{node?.cpu}% CPU</span> &nbsp;
              <span className="text-emerald-400">{node?.ram}% RAM</span> &nbsp;
              <span className="text-violet-400">{node?.disk}% Disk</span> &nbsp;
              <span className="text-muted-foreground">{node?.pods} pods</span>
            </p>
          </div>
          <UiTooltip content="Close panel" side="bottom">
            <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
              <X size={18} />
            </button>
          </UiTooltip>
        </div>

        {/* Tabs + Actions */}
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
            {node?.cordoned ? (
              <ActionBtn icon={<LockOpen size={13} />} label="Uncordon" onClick={() => void uncordon()} disabled={busy} color="#f59e0b" />
            ) : (
              <ActionBtn icon={<Lock size={13} />} label="Cordon" onClick={() => void cordon()} disabled={busy} color="#f59e0b" />
            )}
            <ActionBtn
              icon={<Wind size={13} />}
              label={node?.drained ? 'Drained' : 'Drain'}
              onClick={() => void drain()}
              disabled={busy || Boolean(node?.drained)}
              color={node?.drained ? '#10b981' : '#f59e0b'}
            />
            <ActionBtn icon={<Trash2 size={13} />} label="Delete" onClick={() => void deleteNode()} disabled={busy} color="#ef4444" danger />
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {node && activeTab === 'overview' && <OverviewTab node={node} />}
          {node && activeTab === 'events' && <EventsTab node={node} />}
          {node && activeTab === 'shell' && <ShellTab node={node} />}
          {node && activeTab === 'edit' && <EditTab node={node} />}
        </div>
      </div>
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(drawer, document.body)
}

function ActionBtn({
  icon, label, onClick, disabled = false, color, danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  color?: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded font-modal text-[11.5px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'lucid-button border-border text-muted-foreground hover:text-foreground'
      }`}
      style={!danger && color ? { color, borderColor: `${color}50` } : undefined}
    >
      {icon}{label}
    </button>
  )
}
