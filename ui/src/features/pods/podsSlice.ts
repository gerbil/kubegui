import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import type { Pod } from './types'
import {
  removeResourceByUid,
  ResourceStreamEnvelope,
  ResourceStreamStatus,
  upsertResourceByUid,
} from '@/lib/resourceStream'
import { ResourceList } from '../../../bindings/kubegui/services/backend'

export type FetchStatus = 'idle' | 'loading' | 'succeeded' | 'failed'

interface PodsState {
  items: Pod[]
  status: FetchStatus
  error: string | null
  namespace: string
  globalFilter: string
  streamStatus: ResourceStreamStatus
  streamError: string | null
}

const initialState: PodsState = {
  items: [],
  status: 'idle',
  error: null,
  namespace: 'all',
  globalFilter: '',
  streamStatus: 'idle',
  streamError: null,
}

export const fetchPods = createAsyncThunk<Pod[], string, { rejectValue: string }>(
  'pods/fetch',
  async (namespace, { rejectWithValue }) => {
    try {
      const data = await ResourceList('pods', namespace)
      return Array.isArray(data) ? (data as Pod[]) : []
    } catch (e) {
      return rejectWithValue(String(e))
    }
  }
)

const podsSlice = createSlice({
  name: 'pods',
  initialState,
  reducers: {
    setNamespace(state, action: PayloadAction<string>) {
      state.namespace = action.payload
    },
    setGlobalFilter(state, action: PayloadAction<string>) {
      state.globalFilter = action.payload
    },
    upsertPod(state, action: PayloadAction<Pod>) {
      state.items = upsertResourceByUid(state.items, action.payload)
    },
    removePod(state, action: PayloadAction<Pick<ResourceStreamEnvelope<Pod>, 'uid' | 'item'>>) {
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
      .addCase(fetchPods.pending, (state) => {
        state.status = 'loading'
        state.error = null
        state.streamStatus = 'idle'
        state.streamError = null
      })
      .addCase(fetchPods.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.items = action.payload
      })
      .addCase(fetchPods.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload ?? 'Unknown error'
        state.streamStatus = 'error'
      })
  },
})

export const {
  setNamespace,
  setGlobalFilter,
  upsertPod,
  removePod,
  setStreamStatus,
  setStreamError,
} = podsSlice.actions
export default podsSlice.reducer