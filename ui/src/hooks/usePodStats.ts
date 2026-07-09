import { useEffect, useState } from 'react'
import { PodGetStatsEndpoint, InformerSubscribeResource } from '../../bindings/kubegui/services/backend'
import { Events } from '@wailsio/runtime'
import { coalesce } from '../lib/coalesce'
import { wailsCall } from '../lib/wailsQueue'

export type PodStats = {
  total: number
  healthy: number
  warnings: number
  failed: number
}

type PodStatsState = {
  stats: PodStats
  isLoading: boolean
  error: string | null
}

const DEFAULT_STATS: PodStats = { total: 0, healthy: 0, warnings: 0, failed: 0 }
const DEFAULT_STATE: PodStatsState = {
  stats: DEFAULT_STATS,
  isLoading: false,
  error: null,
}

// Poll interval: refresh stats every 30 seconds
const POLL_INTERVAL_MS = 30_000

/**
 * Fetches aggregate pod health stats from the backend.
 * Queries all namespaces for pod statistics.
 * Polls periodically to keep stats fresh.
 */
export function usePodStats(enabled = true) {
  const [state, setState] = useState<PodStatsState>(DEFAULT_STATE)

  useEffect(() => {
    if (!enabled) {
      setState(DEFAULT_STATE)
      return
    }
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let cacheSynced = false

    // Subscribe so podsInformerChanged events fire when cache updates.
    void InformerSubscribeResource('pods').catch(() => {})
    const resubTimer = window.setTimeout(() => {
      void InformerSubscribeResource('pods').catch(() => {})
    }, 2000)

    const fetchStats = async () => {
      try {
        const stats = await wailsCall(() => PodGetStatsEndpoint())
        if (cancelled) return
        const shouldUpdate = stats.total > 0 || stats.healthy > 0 || cacheSynced
        if (shouldUpdate) {
          setState({
            stats: { total: stats.total, healthy: stats.healthy, warnings: stats.warnings, failed: stats.failed },
            isLoading: false,
            error: null,
          })
        } else {
          // Cache still warming — mark not loading but keep previous stats until we know
          // the watcher has fully synced or the cluster truly has zero pods.
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: null,
          }))
        }
      } catch (err) {
        if (!cancelled) {
          // Don't reset stats to 0 on error — preserve last known good value.
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : 'fetch error',
          }))
        }
      }
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }))
    void fetchStats()

    pollTimer = setInterval(() => { void fetchStats() }, POLL_INTERVAL_MS)

    // Coalesce rapid informer events — during initial sync the backend can emit
    // hundreds of podsInformerChanged events; we only need one fetch per burst.
    const triggerFetch = coalesce(() => { void fetchStats() }, 500)

    const offPods = Events.On('podsInformerChanged', triggerFetch)
    const offSynced = Events.On('informerProgress', (ev: unknown) => {
      const stage = (ev as { data?: { stage?: string } })?.data?.stage
      if (stage === 'synced') {
        cacheSynced = true
        void fetchStats()
      }
    })

    return () => {
      cancelled = true
      clearTimeout(resubTimer)
      if (pollTimer) clearInterval(pollTimer)
      triggerFetch.cancel()
      offPods?.()
      offSynced?.()
    }
  }, [enabled])

  return state
}
