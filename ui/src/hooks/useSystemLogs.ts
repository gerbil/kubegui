import { useEffect, useRef, useState } from 'react'
import { LogsGetCluster, InformerSubscribeResource, InformerUnsubscribeResource } from '../../bindings/kubegui/services/backend'
import { Events } from '@wailsio/runtime'
import { coalesce } from '../lib/coalesce'
import { wailsCall } from '../lib/wailsQueue'

export type SystemLog = {
  timestamp: string
  component: string    // "kubelet", "controller-manager", "scheduler", etc.
  level: string        // "INFO", "WARN", "ERROR"
  message: string
}

/**
 * Fetches real system component logs via SSE stream.
 * Source: /api/v1/stream/cluster-logs (primary), /api/v1/cluster-logs (fallback).
 */
type ClusterLogRow = {
  timestamp?: string
  component?: string
  level?: string
  message?: string
}

export function useSystemLogs(limit = 10) {
  const [items, setItems] = useState<SystemLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    let retryTimer: number | null = null

    // Subscribe so eventsInformerChanged fires when the cache populates.
    void InformerSubscribeResource('events').catch(() => {})

    const fetch = async (attempt = 0) => {
      try {
        const raw = await wailsCall(() => LogsGetCluster(Math.max(limit * 3, 30)))
        if (cancelledRef.current) return
        const rows: ClusterLogRow[] = Array.isArray(raw) ? (raw as ClusterLogRow[]) : []
        const mapped = rows
          .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
          .slice(0, Math.max(limit * 3, 30))
          .map((row) => {
            const level = (row.level ?? 'INFO').toUpperCase()
            return {
              timestamp: row.timestamp ?? new Date(0).toISOString(),
              component: (row.component ?? 'cluster').trim() || 'cluster',
              level,
              message: (row.message ?? '').trim() || `${level.toLowerCase()} event`,
            }
          })
        setItems(mapped)
        setIsLoading(false)
        setError(null)
        // If cache wasn't ready yet (empty result) retry — max 5 × 10 s
        if (mapped.length === 0 && attempt < 5) {
          retryTimer = window.setTimeout(() => { void fetch(attempt + 1) }, 10_000)
        }
      } catch (err) {
        if (!cancelledRef.current) {
          console.warn('[useSystemLogs] fetch error:', err)
          setError(err instanceof Error ? err.message : 'fetch error')
          setIsLoading(false)
          // Retry on error — informer cache may still be warming up
          if (attempt < 5) {
            retryTimer = window.setTimeout(() => { void fetch(attempt + 1) }, 10_000)
          }
        }
      }
    }

    void fetch()
    const timer = setInterval(() => { void fetch() }, 30_000)

    // Re-fetch immediately when caches become fully synced.
    // Events.On receives a WailsEvent wrapper — the actual payload is in ev.data.
    const offSynced = Events.On('informerProgress', (ev: unknown) => {
      const stage = (ev as { data?: { stage?: string } })?.data?.stage
      if (stage === 'synced') void fetch(0)
    })

    // Refresh when the events informer cache changes (coalesced).
    const triggerFetch = coalesce(() => { void fetch(0) }, 500)
    const offEvents = Events.On('eventsInformerChanged', triggerFetch)

    return () => {
      cancelledRef.current = true
      clearInterval(timer)
      if (retryTimer) window.clearTimeout(retryTimer)
      triggerFetch.cancel()
      offSynced?.()
      offEvents?.()
      void InformerUnsubscribeResource('events').catch(() => {})
    }
  }, [limit])

  const logs = [...items]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)

  return { logs, isLoading, error }
}
