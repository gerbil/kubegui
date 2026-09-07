import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit'
import {
  removeResourceByUid,
  ResourceStreamEnvelope,
  ResourceStreamStatus,
  upsertResourceByUid,
} from '@/lib/resourceStream'
import {
  FetchStatus,
  K8sResource,
  NavigationResponse,
  ResourceMenuGroup,
} from './types'
import { ResourceList } from '../../../bindings/kubegui/services/backend'

async function listResourcesViaBinding(resource: string, namespace: string): Promise<K8sResource[]> {
  const data = await ResourceList(resource, namespace)
  return Array.isArray(data) ? (data as K8sResource[]) : []
}

interface ResourcesState {
  items: K8sResource[]
  status: FetchStatus
  error: string | null
  selectedResource: string
  selectedNamespace: string
  globalFilter: string
  streamStatus: ResourceStreamStatus
  streamError: string | null
  menuGroups: ResourceMenuGroup[]
  crdGroups: ResourceMenuGroup[]
}

const initialState: ResourcesState = {
  items: [],
  status: 'idle',
  error: null,
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
}

export const fetchResourceList = createAsyncThunk<
  K8sResource[],
  { resource: string; namespace: string },
  { rejectValue: string }
>('resources/fetchList', async ({ resource, namespace }, { rejectWithValue }) => {
  try {
    return await listResourcesViaBinding(resource, namespace)
  } catch (error) {
    return rejectWithValue(String(error))
  }
})


export const fetchNavigation = createAsyncThunk<NavigationResponse, void, { rejectValue: string }>(
  'resources/fetchNavigation',
  async () => ({
    groups: [],
    crdGroups: [],
    crdDefinitions: {
      resource: 'customresourcedefinitions',
      label: 'Custom Resource Definitions',
      namespaced: false,
    },
  } as NavigationResponse)
)

const resourcesSlice = createSlice({
  name: 'resources',
  initialState,
  reducers: {
    setSelectedResource(state, action: PayloadAction<string>) {
      state.selectedResource = action.payload
      state.items = []
      state.streamStatus = 'idle'
      state.streamError = null
    },
    setSelectedNamespace(state, action: PayloadAction<string>) {
      state.selectedNamespace = action.payload
      state.streamStatus = 'idle'
      state.streamError = null
    },
    setGlobalFilter(state, action: PayloadAction<string>) {
      state.globalFilter = action.payload
    },
    upsertResource(state, action: PayloadAction<K8sResource>) {
      state.items = upsertResourceByUid(state.items, action.payload)
    },
    removeResource(state, action: PayloadAction<Pick<ResourceStreamEnvelope<K8sResource>, 'uid' | 'item'>>) {
      state.items = removeResourceByUid(state.items, action.payload)
    },
    setStreamStatus(state, action: PayloadAction<ResourceStreamStatus>) {
      state.streamStatus = action.payload
    },
    setStreamError(state, action: PayloadAction<string | null>) {
      state.streamError = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchResourceList.pending, (state) => {
        state.status = 'loading'
        state.error = null
        state.streamStatus = 'idle'
        state.streamError = null
      })
      .addCase(fetchResourceList.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.items = action.payload
      })
      .addCase(fetchResourceList.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload ?? 'Unknown error'
        state.streamStatus = 'error'
      })
      .addCase(fetchNavigation.fulfilled, (state, action) => {
        state.menuGroups = action.payload.groups
        state.crdGroups = action.payload.crdGroups
      })
  },
})

export const {
  removeResource,
  setGlobalFilter,
  setSelectedNamespace,
  setSelectedResource,
  setStreamError,
  setStreamStatus,
  upsertResource,
} = resourcesSlice.actions

export default resourcesSlice.reducer