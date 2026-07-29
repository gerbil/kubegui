import { uiNotify } from '../components/ui/UiNotify'

export const CVE_SCANS_ENABLED_STORAGE_KEY = 'ui:cve-scans-enabled'
export const CVE_DB_READY_STORAGE_KEY      = 'ui:cve-db-ready'
export const ENABLE_CVE_SCANS_TOOLTIP      = 'Enable cve scans in settings'
export const CVE_DB_DOWNLOADING_TOOLTIP    = 'CVE database is downloading, please wait…'

const PERSISTENT_STATE_EVENT = 'kubegui:persistent-state'

function setPersistentBool(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    window.dispatchEvent(new CustomEvent(PERSISTENT_STATE_EVENT, { detail: { key, value } }))
  } catch {
    // ignore
  }
}

type CVEDatabaseRefreshReason = 'startup' | 'enable'

type CVEDatabaseRefreshResponse = {
  status?: string
  updatedAt?: string
  cacheDir?: string
  error?: string
}

let cveDatabaseRefreshPromise: Promise<void> | null = null

export function refreshCveDatabases(reason: CVEDatabaseRefreshReason): Promise<void> {
  if (cveDatabaseRefreshPromise) {
    return cveDatabaseRefreshPromise
  }

  if (reason === 'startup') {
    uiNotify.info('Downloading CVE databases in background…')
  } else {
    uiNotify.info('Downloading CVE databases…')
  }

  cveDatabaseRefreshPromise = (async () => {
    try {
      const response = await fetch('/api/v1/cve-db/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = await response.json() as CVEDatabaseRefreshResponse
      if (!response.ok) {
        throw new Error(payload.error || 'CVE database refresh failed')
      }

      setPersistentBool(CVE_DB_READY_STORAGE_KEY, true)

      if (reason === 'startup') {
        uiNotify.success('CVE databases updated in background')
      } else {
        uiNotify.success('CVE databases ready')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CVE database refresh failed'
      if (reason === 'startup') {
        uiNotify.error(`CVE database background update failed: ${message}`)
      } else {
        uiNotify.error(`CVE database download failed: ${message}`)
      }
      throw error
    }
  })().finally(() => {
    cveDatabaseRefreshPromise = null
  })

  return cveDatabaseRefreshPromise
}

