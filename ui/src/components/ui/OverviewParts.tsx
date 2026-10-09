import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import { UiTooltip } from './UiTooltip'

// ─── Search highlight ────────────────────────────────────────────────────────
export const HighlightMatch = forwardRef<HTMLSpanElement, { text: string; query: string; className?: string }>(
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
        <mark key={`${idx}-${parts.length}`} className="rounded bg-primary/30 px-0.5 text-foreground">
          {text.slice(idx, idx + trimmed.length)}
        </mark>,
      )
      cursor = idx + trimmed.length
      idx = lower.indexOf(needle, cursor)
    }
    if (cursor < text.length) parts.push(text.slice(cursor))
    return <span ref={ref} className={className}>{parts}</span>
  },
)

// ─── Section card ────────────────────────────────────────────────────────────
export function SectionCard({
  title,
  count,
  headerAction,
  children,
}: {
  title?: string
  count?: ReactNode
  headerAction?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border/50 bg-white/[0.02] overflow-hidden">
      {(title || headerAction) && (
        <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/40 bg-white/[0.03]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-0.5 h-3.5 rounded-full bg-primary/70 shrink-0" />
            <h4 className="font-modal text-[11px] font-semibold uppercase tracking-wider text-foreground/90 truncate">{title}</h4>
            {count !== undefined && (
              <span className="font-modal text-[10px] px-1.5 py-px rounded-full bg-accent/60 text-muted-foreground tabular-nums">{count}</span>
            )}
          </div>
          {headerAction}
        </header>
      )}
      <div className="p-1.5">{children}</div>
    </section>
  )
}

export function GroupHeader({ label, count }: { label: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-1.5 pt-2 pb-1 first:pt-1">
      <span className="font-modal text-[10px] font-semibold uppercase tracking-wider text-primary/80">{label}</span>
      {count !== undefined && <span className="font-modal text-[9px] text-muted-foreground/50 tabular-nums">{count}</span>}
      <span className="flex-1 h-px bg-border/30" />
    </div>
  )
}

// ─── Path helpers ────────────────────────────────────────────────────────────
function prettySegment(segment: string): ReactNode {
  const match = segment.match(/^(.*?)\[(\d+)\]$/)
  if (!match) return segment
  return (
    <>
      {match[1]}
      <span className="ml-1 px-1 rounded bg-accent/60 text-[9px] text-muted-foreground not-italic">#{Number(match[2]) + 1}</span>
    </>
  )
}

export function splitPath(path: string): string[] {
  return path.split('.')
}

export function PathBreadcrumb({ segments }: { segments: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      {segments.map((segment, i) => (
        <span key={`${segment}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/40">›</span>}
          <span>{prettySegment(segment)}</span>
        </span>
      ))}
    </span>
  )
}

// ─── Key with spec tooltip ───────────────────────────────────────────────────
export function FieldKey({
  label,
  path,
  description,
  query = '',
}: {
  label: string
  path: string
  description?: string
  query?: string
}) {
  const node = (
    <HighlightMatch
      text={label}
      query={query}
      className={description
        ? 'cursor-help text-foreground/70 border-b border-dotted border-muted-foreground/40 hover:text-primary hover:border-primary/60 transition-colors'
        : 'text-foreground/60'}
    />
  )
  if (!description) return node
  return (
    <UiTooltip
      side="bottom"
      align="start"
      content={
        <div className="max-w-full space-y-1.5 text-left leading-relaxed">
          <code className="block font-modal text-[10.5px] text-primary break-all">{path}</code>
          <p className="font-modal text-[11px] text-foreground/90 break-words">{description}</p>
        </div>
      }
    >
      {node}
    </UiTooltip>
  )
}

// ─── Value rendering with semantic highlights ────────────────────────────────
const OK_WORDS = new Set(['running', 'ready', 'active', 'succeeded', 'bound', 'true', 'available', 'healthy', 'complete', 'completed', 'approved'])
const BAD_WORDS = new Set(['failed', 'error', 'crashloopbackoff', 'false', 'notready', 'evicted', 'lost', 'oomkilled', 'imagepullbackoff', 'errimagepull'])
const WARN_WORDS = new Set(['pending', 'unknown', 'warning', 'terminating', 'released', 'progressing'])

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(\/\d{1,3})?$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const QTY_RE = /^-?\d+(\.\d+)?(m|Ki|Mi|Gi|Ti|Pi|Ei|k|K|M|G|T|P|E|s|h|d)?$/
const IMAGE_RE = /^[\w.-]+(:\d+)?\/[\w./-]+(:[\w.-]+)?(@sha256:[0-9a-f]+)?$|^[\w./-]+:[\w.-]+$/

function relativeAge(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (isNaN(diff)) return ''
  const abs = Math.abs(diff)
  const units: Array<[number, string]> = [[86400000, 'd'], [3600000, 'h'], [60000, 'm'], [1000, 's']]
  for (const [ms, unit] of units) {
    if (abs >= ms) return `${Math.floor(abs / ms)}${unit} ${diff >= 0 ? 'ago' : 'from now'}`
  }
  return 'just now'
}

function Pill({ tone, children }: { tone: 'ok' | 'bad' | 'warn' | 'info' | 'muted'; children: ReactNode }) {
  const cls = {
    ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    bad: 'bg-red-500/15 text-red-300 ring-red-500/30',
    warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    info: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    muted: 'bg-white/5 text-muted-foreground ring-white/10',
  }[tone]
  const dot = {
    ok: 'bg-emerald-400', bad: 'bg-red-400', warn: 'bg-amber-400', info: 'bg-sky-400', muted: 'bg-muted-foreground/50',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-px rounded-full ring-1 ring-inset text-[10.5px] font-medium align-middle ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

export function ValueView({ text, query = '' }: { text: string; query?: string }) {
  const hl = (className: string, value: string = text) => <HighlightMatch text={value} query={query} className={className} />
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (trimmed === '' || trimmed === '—') return <span className="text-muted-foreground/40">—</span>
  if (trimmed === '[]' || trimmed === '{}') return <span className="text-muted-foreground/40 font-mono">{trimmed}</span>

  // "True · reason=… message=…" condition lines
  const cond = trimmed.match(/^(True|False|Unknown) · (.*)$/s)
  if (cond) {
    const tone = cond[1] === 'True' ? 'ok' : cond[1] === 'False' ? 'bad' : 'warn'
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Pill tone={tone}>{cond[1]}</Pill>
        {hl('text-muted-foreground', cond[2])}
      </span>
    )
  }

  if (lower === 'true' || lower === 'false') {
    return <Pill tone={lower === 'true' ? 'ok' : 'muted'}>{hl('', trimmed)}</Pill>
  }
  if (OK_WORDS.has(lower)) return <Pill tone="ok">{hl('', trimmed)}</Pill>
  if (BAD_WORDS.has(lower)) return <Pill tone="bad">{hl('', trimmed)}</Pill>
  if (WARN_WORDS.has(lower)) return <Pill tone="warn">{hl('', trimmed)}</Pill>

  if (ISO_RE.test(trimmed)) {
    const age = relativeAge(trimmed)
    return (
      <span>
        {hl('text-amber-200/90')}
        {age && <span className="ml-1.5 text-[10px] text-muted-foreground/60">({age})</span>}
      </span>
    )
  }
  if (UUID_RE.test(trimmed)) return hl('font-mono text-[10.5px] text-muted-foreground')
  if (IP_RE.test(trimmed)) return hl('text-violet-300')
  if (QTY_RE.test(trimmed)) return hl('text-sky-300 tabular-nums')
  if (trimmed.includes('/') && !trimmed.includes(' ') && IMAGE_RE.test(trimmed)) return hl('text-teal-300')
  return hl('text-foreground whitespace-pre-wrap')
}

// ─── Row ─────────────────────────────────────────────────────────────────────
export function FieldRow({ keyNode, valueNode }: { keyNode: ReactNode; valueNode: ReactNode }) {
  return (
    <div className="font-modal text-[11.5px] leading-snug grid grid-cols-[minmax(110px,34%)_1fr] gap-x-3 py-1 px-1.5 rounded-md hover:bg-accent/30 transition-colors">
      <div className="break-words min-w-0">{keyNode}</div>
      <div className="break-words min-w-0 [overflow-wrap:anywhere]">{valueNode}</div>
    </div>
  )
}
