import { useEffect, useState } from 'react'

const PERSISTENT_STATE_EVENT = 'kubegui:persistent-state'

type PersistentStateEventDetail = {
  key: string
  value: unknown
}

function readStoredValue<T>(key: string, initialValue: T): T {
  if (typeof window === 'undefined') return initialValue
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : initialValue
  } catch {
    return initialValue
  }
}

export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => readStoredValue(key, initialValue))

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
      window.dispatchEvent(new CustomEvent<PersistentStateEventDetail>(PERSISTENT_STATE_EVENT, {
        detail: { key, value },
      }))
    } catch {
      // ignore storage errors
    }
  }, [key, value])

  useEffect(() => {
    const syncFromStorage = () => setValue(readStoredValue(key, initialValue))
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return
      syncFromStorage()
    }
    const onPersistentState = (event: Event) => {
      const detail = (event as CustomEvent<PersistentStateEventDetail>).detail
      if (detail?.key !== key) return
      setValue(detail.value as T)
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener(PERSISTENT_STATE_EVENT, onPersistentState)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(PERSISTENT_STATE_EVENT, onPersistentState)
    }
  }, [key])

  return [value, setValue] as const
}