import { useEffect, useState } from 'react'
import { AppConfigGetActiveClusterInfo, AppGetStats } from '../../bindings/kubegui/services/backend'
import { wailsCall } from '../lib/wailsQueue'

export type ClusterInfo = {
  contextName: string
  context: string
  fileName: string
  serverVersion: string
  currentUser: string
}

export type AppStats = {
  vmsGB: number
  cpuPercent: number
}

function hasWailsBridge(): boolean {
  return typeof window !== 'undefined' && ('__wails' in window || '_wails' in window)
}

export function useClusterInfo(enabled = true) {
  const [info, setInfo] = useState<ClusterInfo | null>(null)
  const [appStats, setAppStats] = useState<AppStats | null>(null)

  useEffect(() => {
    if (!enabled) {
      setInfo(null)
      return
    }
    if (!hasWailsBridge()) return

    let cancelled = false
    let retryTimer: number | null = null

    const loadClusterInfo = async (attempt = 0) => {
      try {
        const data = await wailsCall(() => AppConfigGetActiveClusterInfo())
        if (cancelled) return
        const resolved: ClusterInfo = {
          contextName: String(data.contextName ?? ''),
          context: String(data.context ?? ''),
          fileName: String(data.fileName ?? ''),
          serverVersion: String(data.serverVersion ?? ''),
          currentUser: String(data.currentUser ?? 'admin'),
        }
        setInfo(resolved)
        // Retry if server version is still missing (API not reachable yet),
        // up to 6 attempts with increasing delays: 3s, 6s, 10s, 15s, 20s, 30s
        if (!resolved.serverVersion && attempt < 6) {
          const delays = [3000, 6000, 10000, 15000, 20000, 30000]
          retryTimer = window.setTimeout(() => { void loadClusterInfo(attempt + 1) }, delays[attempt])
        }
      } catch (err) {
        console.debug('[useClusterInfo] GetActiveClusterInfo transient:', err)
        if (!cancelled && attempt < 3) {
          retryTimer = window.setTimeout(() => { void loadClusterInfo(attempt + 1) }, 5000)
        }
      }
    }

    void loadClusterInfo()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setAppStats(null)
      return
    }
    if (!hasWailsBridge()) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const loadAppStats = async () => {
      try {
        const stats = await wailsCall(() => AppGetStats())
        if (cancelled) return
        setAppStats({
          vmsGB: Number(stats.vmsGB ?? 0),
          cpuPercent: Number(stats.cpuPercent ?? 0),
        })
      } catch (err) {
        if (cancelled) return
        console.debug('[useClusterInfo] GetAppStats transient:', err)
      }
      if (!cancelled) {
        timer = setTimeout(loadAppStats, 30_000)
      }
    }

    void loadAppStats()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled])

  return { info, appStats }
}
