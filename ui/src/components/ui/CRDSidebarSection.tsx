import { useState, useEffect } from 'react'
import { ChevronRight, Puzzle, Box, Layers } from 'lucide-react'
import clsx from 'clsx'
import { useCRDMenu } from '../../hooks/useCRDMenu'
interface CRDSidebarSectionProps {
  activeItem: string
  onSetActiveItem: (id: string) => void
  onNavigate?: (href: string, itemId: string) => void
  isClusterConnected?: boolean
}
export function CRDSidebarSection({ activeItem, onSetActiveItem, onNavigate, isClusterConnected = false }: CRDSidebarSectionProps) {
  const { groups, loading, error } = useCRDMenu({ enabled: isClusterConnected })
  const [umbrellaOpen, setUmbrellaOpen] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const totalResources = groups.reduce((n, g) => n + g.Items.length, 0)
  // Auto-expand when CRDDefinitionsPage navigates to a specific CRD resource
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; group?: string; plural?: string }>).detail
      if (!detail) return
      const { group } = detail
      if (group) {
        // Open umbrella and expand the matching category
        setUmbrellaOpen(true)
        setExpandedCategories((prev) => {
          const next = new Set(prev)
          next.add(group)
          return next
        })
      } else {
        // Navigating back to CRD Definitions — collapse umbrella (optional: keep open)
        // Keep umbrella open but don't auto-collapse
      }
    }
    window.addEventListener('sidebarCRDNavigate', handler)
    return () => window.removeEventListener('sidebarCRDNavigate', handler)
  }, [])
  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }
  return (
    <div className="space-y-0.5">
      {/* Umbrella row */}
      <button
        onClick={() => setUmbrellaOpen((v) => !v)}
        className={clsx(
          'relative w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 group cursor-pointer',
          'text-muted-foreground hover:text-foreground hover:bg-accent/60'
        )}
      >
        <span className="flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
          <Layers size={16} />
        </span>
        <span className="flex-1 text-left truncate">Custom Resources</span>
        {loading ? (
          <span className="text-[9px] text-muted-foreground/40 mr-1 animate-pulse">…</span>
        ) : error ? (
          <span className="text-[9px] text-red-400/60 mr-1">!</span>
        ) : totalResources > 0 ? (
          <span className="text-[9px] text-muted-foreground/50 mr-1">{totalResources}</span>
        ) : null}
        <ChevronRight
          size={14}
          className={clsx(
            'flex-shrink-0 transition-transform text-muted-foreground/40',
            umbrellaOpen && 'rotate-90'
          )}
        />
      </button>
      {/* Expandable body */}
      {umbrellaOpen && (
        <div className="space-y-0.5 pl-2">
          {loading && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/50 animate-pulse">
              Loading CRDs…
            </div>
          )}
          {!loading && error && (
            <div className="px-3 py-2 text-[10px] text-red-400/70 truncate" title={error}>
              CRDs unavailable
            </div>
          )}
          {!loading && !error && groups.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/40">
              No custom resources found
            </div>
          )}
          {groups.map((group) => {
            const categoryId = `crd-cat-${group.Category}`
            const isExpanded = expandedCategories.has(group.Category)
            const isCategoryActive = activeItem === categoryId
            return (
              <div key={group.Category}>
                {/* Category row */}
                <button
                  onClick={() => toggleCategory(group.Category)}
                  className={clsx(
                    'relative w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 group cursor-pointer',
                    isCategoryActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                  )}
                >
                  <span className={clsx('flex-shrink-0 transition-colors', isCategoryActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')}>
                    <Puzzle size={14} />
                  </span>
                  <span className="flex-1 text-left truncate">{group.Category}</span>
                  <span className="text-[9px] text-muted-foreground/50 mr-1">{group.Items.length}</span>
                  <ChevronRight
                    size={13}
                    className={clsx('flex-shrink-0 transition-transform text-muted-foreground/40', isExpanded && 'rotate-90')}
                  />
                </button>
                {/* CRD resource items */}
                {isExpanded && (
                  <div className="space-y-0.5">
                    {group.Items.map((resource) => {
                      const itemId = `crd-${group.Category}-${resource.Name}`
                      const isActive = activeItem === itemId
                      const href = `/crds/${encodeURIComponent(group.Category)}/${encodeURIComponent(resource.Name)}`
                      return (
                        <button
                          key={resource.Name}
                          onClick={() => {
                            onSetActiveItem(itemId)
                            if (onNavigate) onNavigate(href, itemId)
                          }}
                          className={clsx(
                            'relative w-full flex items-center gap-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 group cursor-pointer',
                            isActive
                              ? 'text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                          )}
                          style={{ paddingLeft: 32 }}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-3 w-[3px] rounded-r-full bg-primary" />
                          )}
                          <span className={clsx('flex-shrink-0 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground/60 group-hover:text-foreground')}>
                            <Box size={11} />
                          </span>
                          <span className="flex-1 text-left truncate">{resource.Label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


