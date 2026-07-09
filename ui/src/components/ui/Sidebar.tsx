import { useState, useEffect } from 'react'
import { menuConfig, sidebarConfig, getMenuConfigForUser, MenuSection } from '../../lib/menu.config'
import { MenuSection as MenuSectionComponent } from './MenuSection'
import { CRDSidebarSection } from './CRDSidebarSection'
import { useMenuPersistence } from '../../hooks/useMenuPersistence'

interface SidebarProps {
  userRole?: 'admin' | 'user' | 'viewer'
  health?: {
    label: string
    value: string
    delta: string
    status?: 'healthy' | 'degraded' | 'down'
  }
  currentPath?: string
  onNavigate?: (href: string, itemId: string) => void
  isClusterConnected?: boolean
}

export function Sidebar({ userRole = 'admin', health: runtimeHealth, currentPath, onNavigate, isClusterConnected = false }: SidebarProps) {
  const { logo, health } = sidebarConfig
  const displayHealth = runtimeHealth ?? health
  const [activeMenuConfig, setActiveMenuConfig] = useState<MenuSection[]>(menuConfig)
  const { expandedItems, activeItem, toggleExpandedItem, updateActiveItem } = useMenuPersistence()
  const [logoSrc, setLogoSrc] = useState<string | null>(logo.imageSrc ?? null)

  useEffect(() => {
    if (userRole) {
      setActiveMenuConfig(getMenuConfigForUser(userRole))
    }
  }, [userRole])

  useEffect(() => {
    setLogoSrc(logo.imageSrc ?? null)
  }, [logo.imageSrc])
  // Listen for in-page CRD navigation events (e.g. from CRDDefinitionsPage name click)
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id) updateActiveItem(id)
    }
    window.addEventListener('sidebarCRDNavigate', handler)
    return () => window.removeEventListener('sidebarCRDNavigate', handler)
  }, [updateActiveItem])

  useEffect(() => {
    if (!currentPath) return
    if (currentPath === '/crd-definitions') {
      updateActiveItem('crd-definitions')
      return
    }
    for (const section of activeMenuConfig) {
      for (const item of section.items) {
        if (item.href === currentPath) {
          updateActiveItem(item.id)
          return
        }
        if (item.subsections) {
          for (const sub of item.subsections) {
            if (sub.href === currentPath) {
              updateActiveItem(sub.id)
              return
            }
          }
        }
      }
    }
    if (currentPath === '/') {
      updateActiveItem('dashboard')
    }
  }, [currentPath, activeMenuConfig, updateActiveItem])

  return (
    <aside className="w-72 shrink-0 bg-background/80 backdrop-blur-xl rounded-xl z-50 flex flex-col overflow-hidden">
      {/* Logo Header */}
      <div className="h-16 flex items-center px-6 mb-6">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 flex items-center justify-center">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt="KubeGUI"
                className="h-8 w-8 object-contain"
                onError={() => {
                  if (logo.imageFallbackSrc && logoSrc !== logo.imageFallbackSrc) {
                    setLogoSrc(logo.imageFallbackSrc)
                    return
                  }
                  setLogoSrc(null)
                }}
              />
            ) : (
              <logo.icon size={18} className="text-foreground" />
            )}
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight font-headline">{logo.name}</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
              {logo.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
        {activeMenuConfig.map((section) => (
          <div key={section.id}>
            <p className="px-2 mb-1 text-[9px] font-bold text-muted-foreground/50 uppercase tracking-[0.12em]">
              {section.label}
            </p>
            <MenuSectionComponent
              items={section.items}
              sectionId={section.id}
              expandedItems={expandedItems}
              activeItem={activeItem}
              onToggleItem={toggleExpandedItem}
              onSetActiveItem={updateActiveItem}
              onNavigate={onNavigate}
            />
            {section.id === 'crd-definitions-section' && (
              <CRDSidebarSection
                activeItem={activeItem}
                onSetActiveItem={updateActiveItem}
                onNavigate={onNavigate}
                isClusterConnected={isClusterConnected}
              />
            )}
          </div>
        ))}

      </nav>

      {/* Health Status Footer */}
      <div className="p-4 mt-auto">
        <div className="p-4 rounded-xl bg-accent/40 border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {displayHealth.label}
            </span>
            <span className={`h-2 w-2 rounded-full animate-pulse ${displayHealth.status === 'down' ? 'bg-red-400' : displayHealth.status === 'degraded' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-headline">{displayHealth.value}</span>
            <span className={`text-[10px] font-medium ${displayHealth.status === 'down' ? 'text-red-400' : displayHealth.status === 'degraded' ? 'text-amber-400' : 'text-emerald-400'}`}>{displayHealth.delta}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
