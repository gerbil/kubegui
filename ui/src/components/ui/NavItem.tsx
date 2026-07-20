import { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import clsx from 'clsx'

interface NavItemProps {
  icon: ReactNode
  label: string
  isActive?: boolean
  onClick?: () => void
  hasChildren?: boolean
  isExpanded?: boolean
  badge?: string
  badgeColor?: 'emerald' | 'amber' | 'red' | 'blue'
  level?: number
}

const badgeColorMap = {
  emerald: 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20',
  amber: 'bg-amber-400/10 text-amber-400 border border-amber-400/20',
  red: 'bg-red-400/10 text-red-400 border border-red-400/20',
  blue: 'bg-blue-400/10 text-blue-400 border border-blue-400/20',
}

export function NavItem({
  icon,
  label,
  isActive = false,
  onClick,
  hasChildren = false,
  isExpanded = false,
  badge,
  badgeColor = 'emerald',
  level = 0,
}: NavItemProps) {
  const paddingLeft = level * 12

  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative w-full flex items-center gap-2 px-3 py-1 rounded-lg text-[12px] font-medium transition-all duration-150 group cursor-pointer',
        isActive
          ? 'text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
      )}
      style={{ paddingLeft: `${12 + paddingLeft}px` }}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-primary" />
      )}
      <span className={clsx('flex-shrink-0 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')}>{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {badge && (
        <span className={clsx('text-[8px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap', badgeColorMap[badgeColor])}>
          {badge}
        </span>
      )}
      {hasChildren && (
        <ChevronRight
          size={14}
          className={clsx('flex-shrink-0 transition-transform', isExpanded && 'rotate-90')}
        />
      )}
    </button>
  )
}
