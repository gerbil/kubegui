import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  className?: string
  variant?: 'running' | 'pending' | 'failed' | 'succeeded' | 'default'
}

const variantMap: Record<string, string> = {
  Running: 'bg-green-500/15 text-green-400 border-green-500/30',
  Pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  Succeeded: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  default: 'bg-muted text-muted-foreground border-border',
}

export function PhaseBadge({ phase }: { phase: string }) {
  const cls = variantMap[phase] ?? variantMap.default
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', cls)}>
      {phase || 'Unknown'}
    </span>
  )
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium border-border bg-muted text-muted-foreground', className)}>
      {children}
    </span>
  )
}