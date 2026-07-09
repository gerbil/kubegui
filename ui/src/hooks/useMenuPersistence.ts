import { useState, useEffect, useCallback } from 'react'

const MENU_STATE_KEY = 'kubegui-menu-state'

interface MenuState {
  expandedItems: string[]
  activeItem: string
}

/**
 * Hook for persisting menu state (expanded/collapsed items) to localStorage
 * Automatically saves and restores state across page reloads
 *
 * @example
 * const { expandedItems, setExpandedItems, activeItem, setActiveItem } = useMenuPersistence()
 */
export function useMenuPersistence() {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [activeItem, setActiveItem] = useState<string>('dashboard')
  const [isLoaded, setIsLoaded] = useState(false)

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MENU_STATE_KEY)
      if (saved) {
        const parsed: MenuState = JSON.parse(saved)
        setExpandedItems(new Set(parsed.expandedItems))
        setActiveItem(parsed.activeItem)
      }
      setIsLoaded(true)
    } catch (error) {
      console.warn('Failed to load menu state from localStorage:', error)
      setIsLoaded(true)
    }
  }, [])

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (!isLoaded) return

    try {
      const state: MenuState = {
        expandedItems: Array.from(expandedItems),
        activeItem,
      }
      localStorage.setItem(MENU_STATE_KEY, JSON.stringify(state))
    } catch (error) {
      console.warn('Failed to save menu state to localStorage:', error)
    }
  }, [expandedItems, activeItem, isLoaded])

  const toggleExpandedItem = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  const expandItem = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      next.add(itemId)
      return next
    })
  }, [])

  const collapseItem = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }, [])

  const updateActiveItem = useCallback((itemId: string) => {
    setActiveItem(itemId)
  }, [])

  return {
    expandedItems,
    activeItem,
    isLoaded,
    toggleExpandedItem,
    expandItem,
    collapseItem,
    updateActiveItem,
  }
}

/**
 * Clear all saved menu state from localStorage
 * Useful for reset/logout scenarios
 */
export function clearMenuState() {
  try {
    localStorage.removeItem(MENU_STATE_KEY)
  } catch (error) {
    console.warn('Failed to clear menu state:', error)
  }
}

/**
 * Get current menu state from localStorage without loading
 * Useful for debugging or inspecting saved state
 */
export function getMenuState(): MenuState | null {
  try {
    const saved = localStorage.getItem(MENU_STATE_KEY)
    return saved ? JSON.parse(saved) : null
  } catch (error) {
    console.warn('Failed to get menu state:', error)
    return null
  }
}