/**
 * Menu System Hooks
 * 
 * Export index for all menu-related custom hooks
 * Usage: import { useUserRole, useMenuSearch, useMenuPersistence, useKubernetesContext } from '@/hooks'
 */

export { useUserRole, useMenuItemState, useMenuSearch } from './useMenuHooks'
export { useMenuPersistence, clearMenuState, getMenuState } from './useMenuPersistence'
export { useKubernetesContext, useKubernetesContextPolling } from './useKubernetesContext'

// Types
export type { MenuItem, MenuSection } from '../lib/menu.config'