/* eslint-disable react-hooks/exhaustive-deps */
import {
  useEffect,
  useState
} from 'react'
import {
  Events
} from '@wailsio/runtime'
import {
  coalesce
} from '../lib/coalesce'
import {
  NodeGetMetrics
} from '../../bindings/kubegui/services/backend'
import {
  wailsCall
} from '../lib/wailsQueue'

const NETWORK_ACTIVITY_EVENT = 'kubegui:network-activity'

type NetworkActivityDetail = {
  phase: 'start' | 'end'
  id: string
  label: string
}

function emitNetworkActivity(detail: NetworkActivityDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<NetworkActivityDetail>(NETWORK_ACTIVITY_EVENT, { detail }))
}

async function withNetworkActivity<T>(label: string, task: () => Promise<T>): Promise<T> {
  const id = `wails:${label}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
  emitNetworkActivity({ phase: 'start', id, label })
  try {
    return await task()
  } finally {
    emitNetworkActivity({ phase: 'end', id, label })
  }
}

export type NodeMetric = {
  cpu: number   // percent 0-100
  ram: number   // percent 0-100
  disk: number  // percent 0-100
  pods: number  // count
}

type NodeMetricRow = {
  name: string
  cpu: number
  ram: number
  disk: number
  pods: number
  podCap: number
}

// Queries node metrics via Wails runtime binding and polls every 5s.
export function useNodeMetrics() {
  const [metrics, setMetrics] = useState<Map<string, NodeMetric>>(new Map())
  const [loading, setLoading] = useState(true)

  const mapRowsToMetrics = (rows: NodeMetricRow[]): Map<string, NodeMetric> => {
    const result = new Map<string, NodeMetric>()
    rows.forEach((row) => {
      result.set(row.name, {
        cpu: row.cpu,
        ram: row.ram,
        disk: row.disk,
        pods: row.pods,
      })
    })
    return result
  }

  const fetchMetrics = async () => {
    try {
      const result = await withNetworkActivity('Loading node metrics content', () => wailsCall(() => NodeGetMetrics()))
      const rows = Array.isArray(result) ? (result as NodeMetricRow[]) : []
      if (rows.length > 0) {
        setMetrics(mapRowsToMetrics(rows))
      }
      setLoading(false)
    } catch (err) {
      console.warn('[useNodeMetrics] metrics fetch error:', err)
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchMetrics()

    // Coalesce rapid informer events — initial sync emits many events per resource.
    const triggerMetrics = coalesce(() => { void fetchMetrics() }, 500)

    const offNodes = Events.On('nodesInformerChanged', triggerMetrics)

    const offPods = Events.On('podsInformerChanged', triggerMetrics)

    // Refresh once the informer caches finish syncing.
    // Events.On receives a WailsEvent wrapper — actual payload is in ev.data.
    const offSynced = Events.On('informerProgress', (ev: unknown) => {
      const stage = (ev as { data?: { stage?: string } })?.data?.stage
      if (stage === 'synced') void fetchMetrics()
    })

    return () => {
      triggerMetrics.cancel()
      offNodes?.()
      offPods?.()
      offSynced?.()
    }
  }, [])

  return { metrics, loading }
}

/**
 * Queries node metrics via Wails backend and keeps a rolling sparkline history.
 * Keeps last N samples for sparkline.
 *
 * DEPRECATED: This hook is no longer used. Use useNodeMetrics() instead which uses SSE.
 */
export function useNodeMetricHistory(nodeName: string, _intervalMs = 30_000, _maxSamples = 20) {
  const intervalMs = _intervalMs
  const maxSamples = _maxSamples
  const [history, setHistory] = useState<NodeMetric[]>([])

  useEffect(() => {
    let cancelled = false
    const fetchMetricForNode = async () => {
      if (!nodeName) return
      try {
        const result = await wailsCall(() => NodeGetMetrics())
        const rows = Array.isArray(result) ? (result as NodeMetricRow[]) : []
        if (cancelled || rows.length === 0) return
        const row = rows.find((r) => r.name === nodeName)
        if (!row) return
        const sample: NodeMetric = {
          cpu: row.cpu,
          ram: row.ram,
          disk: row.disk,
          pods: row.pods,
        }
        setHistory((prev) => [...prev, sample].slice(-Math.max(4, maxSamples)))
      } catch {
        // Keep previous samples when backend is temporarily unavailable.
      }
    }

    setHistory([])
    void fetchMetricForNode()
    const timer = window.setInterval(() => {
      void fetchMetricForNode()
    }, Math.max(30_000, intervalMs))

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [nodeName, intervalMs, maxSamples])

  return history
}
