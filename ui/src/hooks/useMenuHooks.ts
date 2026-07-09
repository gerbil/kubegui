import { useState, useCallback, useEffect } from 'react'
import { getMenuConfigForUser, MenuSection } from '../lib/menu.config'

/**
 * Hook for managing user roles and associated menu visibility
 *
 * @example
 * const { currentRole, setRole, visibleMenu } = useUserRole()
 *
 * // Change user role
 * setRole('admin')
 *
 * // Get filtered menu for current role
 * const filteredMenu = visibleMenu
 */
export function useUserRole(initialRole: 'admin' | 'user' | 'viewer' = 'user') {
  const [currentRole, setCurrentRole] = useState<'admin' | 'user' | 'viewer'>(initialRole)
  const [visibleMenu, setVisibleMenu] = useState<MenuSection[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Update visible menu when role changes
  useEffect(() => {
    setIsLoading(true)
    try {
      const menu = getMenuConfigForUser(currentRole)
      setVisibleMenu(menu)
    } finally {
      setIsLoading(false)
    }
  }, [currentRole])

  const updateRole = useCallback((newRole: 'admin' | 'user' | 'viewer') => {
    setCurrentRole(newRole)
  }, [])

  return {
    currentRole,
    setRole: updateRole,
    visibleMenu,
    isLoading,
  }
}

/**
 * Hook for managing a single menu item's expanded/collapsed state
 *
 * @example
 * const { isExpanded, toggle, expand, collapse } = useMenuItemState()
 */
export function useMenuItemState(initialState = false) {
  const [isExpanded, setIsExpanded] = useState(initialState)

  const toggle = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const expand = useCallback(() => {
    setIsExpanded(true)
  }, [])

  const collapse = useCallback(() => {
    setIsExpanded(false)
  }, [])

  return {
    isExpanded,
    toggle,
    expand,
    collapse,
  }
}

/**
 * Hook for searching/filtering menu items
 *
 * @example
 * const { searchQuery, setSearchQuery, results } = useMenuSearch(menuConfig)
 */
export function useMenuSearch(menuConfig: MenuSection[]) {
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<MenuSection[]>(menuConfig)

  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults(menuConfig)
      return
    }

    const query = searchQuery.toLowerCase()
    const filtered = menuConfig
      .map((section) => ({
        ...section,
        items: section.items
          .filter(
            (item) =>
              item.label.toLowerCase().includes(query) ||
              item.subsections?.some((sub) => sub.label.toLowerCase().includes(query))
          )
          .map((item) => ({
            ...item,
            subsections: item.subsections?.filter((sub) =>
              sub.label.toLowerCase().includes(query)
            ),
          })),
      }))
      .filter((section) => section.items.length > 0)

    setResults(filtered)
  }, [searchQuery, menuConfig])

  return {
    searchQuery,
    setSearchQuery,
    results,
  }
}