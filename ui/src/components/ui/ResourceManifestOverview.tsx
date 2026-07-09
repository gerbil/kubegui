import { UiTooltip } from './UiTooltip'
import type { OverviewFieldSpec } from '../../features/resources/resourceOverview'
import { resolveOverviewValue, K8S_FIELD_DESCRIPTIONS } from '../../features/resources/resourceOverview'
import { conditionBadge } from '@/lib/utils'
import { forwardRef } from 'react'
import type { ReactNode } from 'react'
const HIDDEN_ANNOTATION_KEYS = new Set([
  'kubectl.kubernetes.io/last-applied-configuration',
])
// ─── Shared Events Timeline ───────────────────────────────────────────────────
export type KubeEventItem = Record<string, unknown>
function fmtTs(ts: string) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
function sortEvents(list: KubeEventItem[]): KubeEventItem[] {
  return list.slice().sort((a, b) => {
    const ta = String((a.lastTimestamp ?? (a.metadata as Record<string, unknown> | undefined)?.creationTimestamp ?? a.time ?? a.eventTime) ?? '')
    const tb = String((b.lastTimestamp ?? (b.metadata as Record<string, unknown> | undefined)?.creationTimestamp ?? b.time ?? b.eventTime) ?? '')
    return new Date(tb).getTime() - new Date(ta).getTime()
  })
}
export function EventsTimeline({ events, loading, error }: { events: KubeEventItem[]; loading?: boolean; error?: string | null }) {
  if (loading) return <p className="text-[11px] text-muted-foreground px-5 py-4">Loading events...</p>
  if (error) return <p className="text-[11px] text-red-400 px-5 py-4">Error: {error}</p>
  if (events.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center select-none">
      <div className="w-10 h-10 rounded-full bg-accent/30 flex items-center justify-center mb-3">
        <svg className="w-5 h-5 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <p className="text-[12px] font-semibold text-muted-foreground mb-1">No events found</p>
      <p className="text-[11px] text-muted-foreground/40 max-w-[220px] leading-relaxed">
        No events have been recorded for this resource yet.
      </p>
    </div>
  )
  const sorted = sortEvents(events)
  // Detect mixed kinds so we can show kind badges when events come from child resources
  const kinds = new Set(sorted.map(ev => {
    const io = ev.involvedObject as Record<string, unknown> | undefined ?? ev.regarding as Record<string, unknown> | undefined
    return String(io?.kind ?? '')
  }).filter(Boolean))
  const showKindBadge = kinds.size > 1
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="relative">
        <div className="absolute top-0 bottom-0 bg-border/40" style={{ left: '7.75rem', width: '1px', zIndex: 0 }} />
        {sorted.map((ev, i) => {
          const reason = ev.reason as string | undefined
          const message = ev.message as string | undefined
          const evType = (ev.type as string | undefined)?.toLowerCase() ?? 'normal'
          const ts = String(ev.lastTimestamp ?? (ev.metadata as Record<string, unknown> | undefined)?.creationTimestamp ?? ev.time ?? ev.eventTime ?? '')
          const count = Number(ev.count ?? 1)
          const io = ev.involvedObject as Record<string, unknown> | undefined ?? ev.regarding as Record<string, unknown> | undefined
          const involvedKind = String(io?.kind ?? '')
          const involvedName = String(io?.name ?? '')
          const ringCls = evType === 'warning' ? 'border-amber-400'
            : evType === 'error' ? 'border-red-400'
            : 'border-emerald-400'
          const textCls = evType === 'warning' ? 'text-amber-400'
            : evType === 'error' ? 'text-red-400'
            : 'text-emerald-400'
          const cardCls = evType === 'warning' ? 'bg-amber-500/[0.13]'
            : evType === 'error' ? 'bg-red-500/[0.13]'
            : 'bg-white/[0.04]'
          return (
            <div key={i} className="flex items-center mb-3" style={{ zIndex: 1, position: 'relative' }}>
              <div className="shrink-0 text-right pr-3" style={{ width: '7.5rem' }}>
                <span className="text-[11px] text-muted-foreground/70 whitespace-nowrap select-none">
                  {fmtTs(ts)}
                </span>
              </div>
              <div className="shrink-0 flex items-center justify-center" style={{ width: '0.5rem', zIndex: 2 }}>
                <div className={`w-3.5 h-3.5 rounded-full border-[3px] bg-card ${ringCls}`} style={{ marginLeft: '-7px', position: 'relative', left: '4px' }} />
              </div>
              <div className={`flex-1 ml-4 rounded-md px-3 py-2 ${cardCls}`}>
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className={`text-[10px] font-semibold ${textCls}`}>{reason || 'Unknown'}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {showKindBadge && involvedKind && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/50 text-muted-foreground/80 font-mono" title={involvedName}>
                        {involvedKind}
                      </span>
                    )}
                    {count > 1 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/60 text-muted-foreground">×{count}</span>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug break-all">{message || 'No message'}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
// ─── Shared flat line rendering ──────────────────────────────────────────────
type FlatLine = { key: string; value: string }
function normalizeFilter(query: string) {
  return query.trim().toLowerCase()
}
function lineMatches(line: FlatLine, normalizedQuery: string) {
  if (!normalizedQuery) return true
  return line.key.toLowerCase().includes(normalizedQuery) || line.value.toLowerCase().includes(normalizedQuery)
}

function getFieldDescriptionKey(path: string): string | undefined {
  const normalized = path.replace(/\[\d+\]/g, '')
  if (K8S_FIELD_DESCRIPTIONS[path]) return path
  if (K8S_FIELD_DESCRIPTIONS[normalized]) return normalized

  const parts = normalized.split('.')
  for (let length = parts.length - 1; length >= 2; length -= 1) {
    const candidate = parts.slice(0, length).join('.')
    if (K8S_FIELD_DESCRIPTIONS[candidate]) return candidate
  }
  return undefined
}
const HighlightMatch = forwardRef<HTMLSpanElement, { text: string; query: string; className?: string }>(
  function HighlightMatch({ text, query, className }, ref) {
    const trimmed = query.trim()
    if (!trimmed) return <span ref={ref} className={className}>{text}</span>
    const lower = text.toLowerCase()
    const needle = trimmed.toLowerCase()
    const parts: ReactNode[] = []
    let cursor = 0
    let idx = lower.indexOf(needle)
    while (idx !== -1) {
      if (idx > cursor) parts.push(text.slice(cursor, idx))
      parts.push(
        <mark key={`${idx}-${parts.length}`} className="rounded bg-primary/25 px-0.5 text-foreground">
          {text.slice(idx, idx + trimmed.length)}
        </mark>,
      )
      cursor = idx + trimmed.length
      idx = lower.indexOf(needle, cursor)
    }
    if (cursor < text.length) parts.push(text.slice(cursor))
    return <span ref={ref} className={className}>{parts}</span>
  }
)
function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
function primitiveToString(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value || '""'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
function flattenValue(value: unknown, path: string, out: FlatLine[], depth = 0) {
  if (value === null || value === undefined) {
    out.push({ key: path, value: '—' })
    return
  }
  if (typeof value !== 'object') {
    out.push({ key: path, value: primitiveToString(value) })
    return
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ key: path, value: '[]' })
      return
    }
    if (value.every(isPrimitive)) {
      out.push({ key: path, value: value.map(primitiveToString).join(', ') })
      return
    }
    if (depth >= 8) {
      out.push({ key: path, value: JSON.stringify(value) })
      return
    }
    value.forEach((item, index) => flattenValue(item, `${path}[${index}]`, out, depth + 1))
    return
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined)
  if (entries.length === 0) {
    out.push({ key: path, value: '{}' })
    return
  }
  if (depth >= 8) {
    out.push({ key: path, value: JSON.stringify(value) })
    return
  }
  entries.forEach(([key, nested]) => flattenValue(nested, path ? `${path}.${key}` : key, out, depth + 1))
}
function appendConditionLines(value: unknown, path: string, lines: FlatLine[]) {
  if (!Array.isArray(value)) return
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      lines.push({ key: `${path}[${index}]`, value: primitiveToString(item) })
      return
    }
    const obj = item as Record<string, unknown>
    const type = String(obj.type ?? `condition-${index}`)
    const status = String(obj.status ?? '').trim()
    const reason = obj.reason ? `reason=${String(obj.reason)}` : ''
    const message = obj.message ? `message=${String(obj.message)}` : ''
    const details = [reason, message].filter(Boolean).join(' ')
    lines.push({ key: `${path}.${type}`, value: details || (status && !['true', 'false'].includes(status.toLowerCase()) ? status : '—') })
  })
}
function FlatLines({ title, lines, query = '', headerAction }: { title: string; lines: FlatLine[]; query?: string; headerAction?: ReactNode }) {
  const normalizedQuery = normalizeFilter(query)
  const filtered = lines.filter((line) => lineMatches(line, normalizedQuery))
  if (lines.length === 0) return null
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">
          {title}
          <span className="ml-1.5 text-muted-foreground/50 normal-case tracking-normal">
            ({filtered.length}{filtered.length !== lines.length ? `/${lines.length}` : ''})
          </span>
        </p>
        {headerAction}
      </div>
      <div className="space-y-0.5">
        {filtered.map((line, index) => {
          const descriptionKey = getFieldDescriptionKey(line.key)
          const description = descriptionKey ? K8S_FIELD_DESCRIPTIONS[descriptionKey] : undefined
          const keyNode = (
            <HighlightMatch
              text={line.key}
              query={query}
              className={description
                ? 'inline cursor-help text-muted-foreground/70 underline decoration-dotted underline-offset-2'
                : 'text-muted-foreground/70'}
            />
          )

          return (
            <div key={`${line.key}:${index}`} className="font-modal text-[11.5px] leading-snug py-1 px-1 rounded hover:bg-accent/30 break-all">
              {description ? (
                <UiTooltip
                  content={
                    <div className="max-w-full space-y-1 text-left leading-relaxed">
                      <p className="font-modal text-[11px] text-muted-foreground break-all">{descriptionKey}</p>
                      <p className="font-modal text-[11px] text-foreground/90 break-words">{description}</p>
                    </div>
                  }
                  side="bottom"
                  align="start"
                >
                  {keyNode}
                </UiTooltip>
              ) : keyNode}
              <span className="text-muted-foreground/50">: </span>
              <HighlightMatch text={line.value} query={query} className="text-foreground" />
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-[10px] text-muted-foreground/40 px-1 py-1">No matches for "{query}"</p>
        )}
      </div>
    </div>
  )
}
// ─── Shared Labels / Annotations ─────────────────────────────────────────────
export function LabelsSection({ resource, query = '' }: { resource: Record<string, unknown>; query?: string }) {
  const raw = (resource.metadata as Record<string, unknown> | undefined)?.labels
  if (!raw || typeof raw !== 'object') return null
  const entries = Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({ key, value: primitiveToString(value) }))
  if (entries.length === 0) return null
  return <FlatLines title="Labels" lines={entries} query={query} />
}
export function AnnotationsSection({ resource, query = '' }: { resource: Record<string, unknown>; query?: string }) {
  const raw = (resource.metadata as Record<string, unknown> | undefined)?.annotations
  if (!raw || typeof raw !== 'object') return null
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => !HIDDEN_ANNOTATION_KEYS.has(key))
    .map(([key, value]) => ({ key, value: primitiveToString(value) }))
  if (entries.length === 0) return null
  return <FlatLines title="Annotations" lines={entries} query={query} />
}
// ─── Dynamic resource sections ───────────────────────────────────────────────
export function DynamicResourceSection({
  title,
  data,
  query = '',
}: {
  title: string
  data: unknown
  query?: string
}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const lines: FlatLine[] = []
  Object.entries(data as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined)
    .forEach(([key, value]) => flattenValue(value, key, lines))
  return <FlatLines title={title} lines={lines} query={query} />
}
// ─── Manifest field reference (static hardcoded fields) ──────────────────────
export function ResourceManifestOverview({
  resource,
  fields,
  title = 'Manifest Reference',
  hideEmpty = false,
}: {
  resource: Record<string, unknown>
  fields: OverviewFieldSpec[]
  title?: string
  hideEmpty?: boolean
}) {
  const rows = hideEmpty
    ? fields.filter((field) => resolveOverviewValue(resource, field) !== '—')
    : fields
  if (rows.length === 0) return null
  const renderOverviewCell = (field: OverviewFieldSpec): ReactNode => {
    if (field.path === 'status.conditions') {
      const status = resource.status as Record<string, unknown> | undefined
      const raw = status?.conditions
      const conditions = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
      if (conditions.length === 0) {
        return <span className="font-modal text-[11.5px] text-muted-foreground/50">—</span>
      }
      return (
        <span className="inline-flex flex-wrap gap-1.5 align-middle">
          {conditions.map((condition, index) => (
            <span key={`${condition?.type}-${index}`}>
              {conditionBadge(String(condition?.type ?? ''), String(condition?.status ?? 'Unknown'))}
            </span>
          ))}
        </span>
      )
    }
    return <span>{resolveOverviewValue(resource, field)}</span>
  }
  return (
    <div>
      {title && <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{title}</p>}
      <div className="space-y-0.5">
        {rows.map((field) => (
          <div key={field.path} className="font-modal text-[11.5px] leading-snug py-1 px-1 rounded hover:bg-accent/30 break-all">
            <UiTooltip
              content={
                <div className="max-w-full space-y-1 text-left leading-relaxed">
                  <p className="font-modal text-[11px] text-muted-foreground break-all">{field.path}</p>
                  <p className="font-modal text-[11px] text-foreground/90 break-words">{field.description}</p>
                </div>
              }
              side="bottom"
              align="start"
            >
              <span className="inline cursor-help text-muted-foreground/70 underline decoration-dotted underline-offset-2">
                {field.path}
              </span>
            </UiTooltip>
            <span className="text-muted-foreground/50">: </span>
            <span className="text-foreground">{renderOverviewCell(field)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
/**
 * Renders a K8s resource section (spec/status/etc.) as flat lines.
 * Strips: explicit omit list + any top-level key containing "template" (case-insensitive).
 */
export function TooltipResourceSection({
  title,
  data,
  sectionPrefix,
  omit = [],
  query = '',
  headerAction,
}: {
  title: string
  data: unknown
  sectionPrefix: string
  omit?: string[]
  query?: string
  headerAction?: ReactNode
}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const omitSet = new Set(omit)
  const lines: FlatLine[] = []
  Object.entries(data as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        !omitSet.has(key) &&
        !key.toLowerCase().includes('template') &&
        value !== null &&
        value !== undefined,
    )
    .forEach(([key, value]) => {
      if (key === 'conditions' && Array.isArray(value)) {
        appendConditionLines(value, `${sectionPrefix}.${key}`, lines)
        return
      }
      flattenValue(value, `${sectionPrefix}.${key}`, lines)
    })
  return <FlatLines title={title} lines={lines} query={query} headerAction={headerAction} />
}
