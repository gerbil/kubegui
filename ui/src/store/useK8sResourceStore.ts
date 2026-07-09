import { create } from 'zustand'
/** A flattened row used for tables in resource views. */
export type ResourceRow = {
  uid: string
  name: string
  namespace: string
  kind: string
  status: string
  createdAt: string
  /** Everything from the raw K8s object except metadata (spec, status, type, etc.) */
  extra: Record<string, unknown>
}
type ResourceSlice = {
  items: ResourceRow[]
  loading: boolean
  error: string | null
}
interface K8sResourceStore {
  /** Keyed by "<resource>:<namespace>" e.g. "pods:default" or "pods:all" */
  slices: Record<string, ResourceSlice>
  setItems: (key: string, items: ResourceRow[]) => void
  setLoading: (key: string, loading: boolean) => void
  setError: (key: string, error: string | null) => void
}
const emptySlice: ResourceSlice = { items: [], loading: false, error: null }
/**
 * Global Zustand store that caches resource lists keyed by "<resource>:<namespace>".
 * One logical slice per resource type + namespace combination.
 * Data persists across navigation so revisiting a page is instant.
 */
export const useK8sResourceStore = create<K8sResourceStore>()((set) => ({
  slices: {},
  setItems: (key, items) =>
    set((s) => ({
      slices: {
        ...s.slices,
        [key]: { ...(s.slices[key] ?? emptySlice), items, loading: false, error: null },
      },
    })),
  setLoading: (key, loading) =>
    set((s) => ({
      slices: {
        ...s.slices,
        [key]: { ...(s.slices[key] ?? emptySlice), loading },
      },
    })),
  setError: (key, error) =>
    set((s) => ({
      slices: {
        ...s.slices,
        [key]: { ...(s.slices[key] ?? emptySlice), error, loading: false },
      },
    })),
}))
