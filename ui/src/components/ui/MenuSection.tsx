import { MenuItem } from '../../lib/menu.config'
import { NavItem } from './NavItem'

interface MenuSectionProps {
  items: MenuItem[]
  sectionId: string
  expandedItems: Set<string>
  activeItem: string
  onToggleItem: (itemId: string) => void
  onSetActiveItem: (itemId: string) => void
  onNavigate?: (href: string, itemId: string) => void
}

export function MenuSection({
  items,
  expandedItems,
  activeItem,
  onToggleItem,
  onSetActiveItem,
  onNavigate,
}: MenuSectionProps) {
  const handleItemClick = (itemId: string, hasSubsections: boolean, href?: string) => {
    if (hasSubsections) {
      // parent items only expand/collapse — never navigate
      onToggleItem(itemId)
      onSetActiveItem(itemId)
      return
    }
    onSetActiveItem(itemId)
    if (href && onNavigate) {
      onNavigate(href, itemId)
    }
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.id}>
          <NavItem
            icon={<item.icon size={16} />}
            label={item.label}
            isActive={activeItem === item.id}
            onClick={() => handleItemClick(item.id, !!(item.subsections?.length), item.href)}
            hasChildren={!!(item.subsections?.length)}
            isExpanded={expandedItems.has(item.id)}
            badge={item.badge}
            badgeColor={item.badgeColor}
          />
          {/* Subsections */}
          {item.subsections && expandedItems.has(item.id) && (
            <div className="space-y-1">
              {item.subsections.map((subsection) => (
                <NavItem
                  key={subsection.id}
                  icon={<subsection.icon size={14} />}
                  label={subsection.label}
                  isActive={activeItem === subsection.id}
                  onClick={() => {
                    onSetActiveItem(subsection.id)
                    if (subsection.href && onNavigate) {
                      onNavigate(subsection.href, subsection.id)
                    }
                  }}
                  level={1}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}