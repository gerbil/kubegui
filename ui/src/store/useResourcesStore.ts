import { create } from 'zustand'
import { upsertResourceByUid, removeResourceByUid, ResourceStreamEnvelope, ResourceStreamStatus } from '@/lib/resourceStream'
import type { K8sResource, ResourceMenuGroup } from '@/features/resources/types'

interface ResourcesState {
  items: K8sResource[]
  selectedResource: string
  selectedNamespace: string
  globalFilter: string
  streamStatus: ResourceStreamStatus
  streamError: string | null
  menuGroups: ResourceMenuGroup[]
  crdGroups: ResourceMenuGroup[]
  setSelectedResource: (resource: string) => void
  setSelectedNamespace: (namespace: string) => void
  setGlobalFilter: (filter: string) => void
  upsertResource: (item: K8sResource) => void
  removeResource: (payload: Pick<ResourceStreamEnvelope<K8sResource>, 'uid' | 'item'>) => void
  setStreamStatus: (status: ResourceStreamStatus) => void
  setStreamError: (error: string | null) => void
  setItems: (items: K8sResource[]) => void
  fetchNavigation: () => Promise<void>
}

export const useResourcesStore = create<ResourcesState>()((set) => ({
  items: [],
  selectedResource: 'pods',
  selectedNamespace: 'all',
  globalFilter: '',
  streamStatus: 'idle',
  streamError: null,
  menuGroups: [
    {
      key: 'workloads',
      label: 'Workloads',
      items: [{ resource: 'pods', label: 'Pods', namespaced: true }],
    },
    {
      key: 'networking',
      label: 'Networking',
      items: [{ resource: 'services', label: 'Services', namespaced: true }],
    },
  ],
  crdGroups: [],

  setSelectedResource: (resource) =>
    set({ selectedResource: resource, items: [], streamStatus: 'idle', streamError: null }),
  setSelectedNamespace: (namespace) =>
    set({ selectedNamespace: namespace, streamStatus: 'idle', streamError: null }),
  setGlobalFilter: (filter) => set({ globalFilter: filter }),
  upsertResource: (item) =>
    set((s) => ({ items: upsertResourceByUid(s.items, item) })),
  removeResource: (payload) =>
    set((s) => ({ items: removeResourceByUid(s.items, payload) })),
  setStreamStatus: (status) => set({ streamStatus: status }),
  setStreamError: (error) => set({ streamError: error }),
  setItems: (items) => set({ items }),

  fetchNavigation: async () => {
    // Navigation is built statically; no backend call needed.
  },
}))