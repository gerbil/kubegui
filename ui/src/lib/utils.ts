import { clsx, ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { createElement } from 'react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatAge(timestamp: string | undefined): string {
  if (!timestamp) return '—'
  const diff = Date.now() - new Date(timestamp).getTime()
  if (diff < 0) return '0s'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(mo / 12)}y`
}

export function podPhaseColor(phase: string): string {
  switch (phase) {
    case 'Running': return 'text-green-400'
    case 'Pending': return 'text-yellow-400'
    case 'Failed': return 'text-red-400'
    case 'Succeeded': return 'text-indigo-400'
    default: return 'text-gray-400'
  }
}

/**
 * Ratio display (e.g. "2/3" or ready/desired counts) - plain colored text.
 * Green = all ready, amber = partial, red = none, muted = unknown.
 */
export function ratioBadge(readyOrStr: number | string, desired?: number): ReturnType<typeof createElement> {
  let ready: number
  let des: number

  if (typeof readyOrStr === 'string') {
    const [leftRaw, rightRaw] = readyOrStr.split('/')
    ready = Number(leftRaw)
    des = Number(rightRaw)

    if (!Number.isFinite(ready) || !Number.isFinite(des)) {
      return createElement(
        'span',
        { className: 'text-sm tabular-nums text-muted-foreground' },
        readyOrStr,
      )
    }
  } else {
    ready = readyOrStr
    des = desired ?? 0
  }

  const cls =
    des === 0
      ? 'text-muted-foreground'
      : ready >= des
        ? 'text-emerald-400'
        : ready > 0
          ? 'text-amber-400'
          : 'text-red-400'
  return createElement(
    'span',
    { className: `text-sm tabular-nums font-medium ${cls}` },
    `${ready}/${des}`,
  )
}

/**
 * Count display – plain colored text. Green for 0, amber for low, red for high.
 */
export function countBadge(value: number, _warnAt = 1, errorAt = 5): ReturnType<typeof createElement> {
  const cls =
    value === 0
      ? 'text-emerald-400'
      : value < errorAt
        ? 'text-amber-400'
        : 'text-red-400'
  return createElement(
    'span',
    { className: `text-sm tabular-nums font-medium ${cls}` },
    String(value),
  )
}

/**
 * Status display for Kubernetes resources – plain colored text.
 * Green = ready/running/active/succeeded/available, Amber = pending/creating/progressing, Red = failed/error.
 */
export function statusBadge(status: string): ReturnType<typeof createElement> {
  const n = status.toLowerCase()
  const cls =
    n.includes('ready') || n.includes('running') || n.includes('active') || n.includes('succeeded') || n === 'true' || n.includes('available')
      ? 'text-emerald-400'
      : n.includes('pending') || n.includes('creating') || n.includes('unknown') || n.includes('terminating') || n.includes('progressing')
        ? 'text-amber-400'
        : 'text-red-400'
  return createElement(
    'span',
    { className: `text-sm font-medium ${cls}`, title: status },
    status,
  )
}

/**
 * Boolean display (True/False or Yes/No) – plain colored text.
 * Green = true, Red = false.
 */
export function booleanBadge(value: boolean, trueLabel = 'True', falseLabel = 'False'): ReturnType<typeof createElement> {
  const cls = value
    ? 'text-emerald-400'
    : 'text-red-400'
  return createElement(
    'span',
    { className: `text-sm font-medium ${cls}` },
    value ? trueLabel : falseLabel,
  )
}

/**
 * Event type display (Warning/Normal) – plain colored text.
 * Amber = Warning, Sky = Normal/Info.
 */
export function eventTypeBadge(type: string): ReturnType<typeof createElement> {
  const cls = type === 'Warning'
    ? 'text-amber-400'
    : 'text-sky-400'
  return createElement(
    'span',
    { className: `text-sm font-medium ${cls}` },
    type,
  )
}

/**
 * Condition display for Kubernetes condition types – plain colored text.
 * If status is provided: Green=true, Red=false, Amber=unknown.
 * Without status: fall back to type-based coloring.
 */
export function conditionBadge(conditionType: string, conditionStatus?: string): ReturnType<typeof createElement> {
  const lower = conditionType.toLowerCase()
  const normalizedStatus = String(conditionStatus ?? '').toLowerCase()
  const cls = normalizedStatus
    ? normalizedStatus === 'true'
      ? 'text-emerald-400'
      : normalizedStatus === 'false'
        ? 'text-red-400'
        : 'text-amber-400'
    : lower === 'ready'
      ? 'text-emerald-400'
      : lower.includes('pressure') || lower.includes('failed') || lower.includes('error')
        ? 'text-red-400'
        : 'text-slate-400'

  const label = conditionType || 'Condition'

  return createElement(
    'span',
    { className: `text-sm font-medium ${cls}` },
    label,
  )
}
