import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { ResourceList } from '../../../bindings/kubegui/services/backend'

export type FetchStatus = 'idle' | 'loading' | 'succeeded' | 'failed'

interface NamespacesState {
  items: string[]
  status: FetchStatus
  error: string | null
}

const initialState: NamespacesState = {
  items: [],
  status: 'idle',
  error: null,
}

export const fetchNamespaces = createAsyncThunk<string[], void, { rejectValue: string }>(
  'namespaces/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const response = await ResourceList('namespaces', 'all')
      const arr: Array<unknown> = Array.isArray(response) ? response : []
      const names = arr
        .map((item) => {
          const meta = (item as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined
          return meta?.name
        })
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b))

      return names
    } catch (error) {
      return rejectWithValue(String(error))
    }
  },
)

const namespacesSlice = createSlice({
  name: 'namespaces',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchNamespaces.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchNamespaces.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.items = action.payload
      })
      .addCase(fetchNamespaces.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload ?? 'Unknown error'
      })
  },
})

export default namespacesSlice.reducer