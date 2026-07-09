import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface NavigationState {
  activeItem: string
  expandedSections: Set<string>
  expandedItems: Set<string>
}

const initialState: NavigationState = {
  activeItem: 'dashboard',
  expandedSections: new Set(['overview']),
  expandedItems: new Set(['namespaces', 'workloads', 'configuration', 'network', 'storage', 'settings', 'metrics', 'alerts', 'rbac']),
}

export const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setActiveItem: (state, action: PayloadAction<string>) => {
      state.activeItem = action.payload
    },
    toggleSection: (state, action: PayloadAction<string>) => {
      if (state.expandedSections.has(action.payload)) {
        state.expandedSections.delete(action.payload)
      } else {
        state.expandedSections.add(action.payload)
      }
    },
    toggleItem: (state, action: PayloadAction<string>) => {
      if (state.expandedItems.has(action.payload)) {
        state.expandedItems.delete(action.payload)
      } else {
        state.expandedItems.add(action.payload)
      }
    },
    expandSection: (state, action: PayloadAction<string>) => {
      state.expandedSections.add(action.payload)
    },
    collapseSection: (state, action: PayloadAction<string>) => {
      state.expandedSections.delete(action.payload)
    },
    expandItem: (state, action: PayloadAction<string>) => {
      state.expandedItems.add(action.payload)
    },
    collapseItem: (state, action: PayloadAction<string>) => {
      state.expandedItems.delete(action.payload)
    },
  },
})

export const {
  setActiveItem,
  toggleSection,
  toggleItem,
  expandSection,
  collapseSection,
  expandItem,
  collapseItem,
} = navigationSlice.actions

export default navigationSlice.reducer