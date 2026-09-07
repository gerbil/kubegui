import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NavigationState {
  activeItem: string
  expandedSections: string[]
  expandedItems: string[]
  setActiveItem: (item: string) => void
  toggleSection: (section: string) => void
  toggleItem: (item: string) => void
  expandSection: (section: string) => void
  collapseSection: (section: string) => void
  expandItem: (item: string) => void
  collapseItem: (item: string) => void
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      activeItem: 'dashboard',
      expandedSections: ['overview'],
      expandedItems: ['namespaces', 'workloads', 'configuration', 'network', 'storage', 'settings', 'metrics', 'alerts', 'rbac'],
      setActiveItem: (item) => set({ activeItem: item }),
      toggleSection: (section) =>
        set((s) => ({
          expandedSections: s.expandedSections.includes(section)
            ? s.expandedSections.filter((x) => x !== section)
            : [...s.expandedSections, section],
        })),
      toggleItem: (item) =>
        set((s) => ({
          expandedItems: s.expandedItems.includes(item)
            ? s.expandedItems.filter((x) => x !== item)
            : [...s.expandedItems, item],
        })),
      expandSection: (section) =>
        set((s) => ({
          expandedSections: s.expandedSections.includes(section)
            ? s.expandedSections
            : [...s.expandedSections, section],
        })),
      collapseSection: (section) =>
        set((s) => ({ expandedSections: s.expandedSections.filter((x) => x !== section) })),
      expandItem: (item) =>
        set((s) => ({
          expandedItems: s.expandedItems.includes(item)
            ? s.expandedItems
            : [...s.expandedItems, item],
        })),
      collapseItem: (item) =>
        set((s) => ({ expandedItems: s.expandedItems.filter((x) => x !== item) })),
    }),
    { name: 'kubegui:navigation' },
  ),
)