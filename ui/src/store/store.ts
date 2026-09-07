import { configureStore } from '@reduxjs/toolkit'
import resourcesReducer from '../features/resources/resourcesSlice'
import navigationReducer from './slices/navigationSlice'
import namespacesReducer from './slices/namespacesSlice'

export const store = configureStore({
  reducer: {
    resources: resourcesReducer,
    navigation: navigationReducer,
    namespaces: namespacesReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch