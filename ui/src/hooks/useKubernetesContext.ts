import { useState, useEffect } from 'react'
import { getRuntimeActiveClusterConfig, getRuntimeClusterConfigs } from '../lib/dbRuntime'
import { Events } from '@wailsio/runtime'

type ClusterConfig = {
  contextName?: string
  ContextName?: string
  context?: string
  Context?: string
  fileName?: string
  FileName?: string
  active?: number | boolean | string
  Active?: number | boolean | string
}


function isActiveValue(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true'
}

function readContextName(cfg: ClusterConfig): string {
  return cfg.contextName || cfg.ContextName || ''
}

function pickContextName(configs: ClusterConfig[]): string {
  const active = configs.find((cfg) => isActiveValue(cfg.active) || isActiveValue(cfg.Active))
  const activeName = active ? readContextName(active) : ''
  if (activeName) return activeName

  const firstName = configs.length > 0 ? readContextName(configs[0]) : ''
  if (firstName) return firstName
  return 'default'
}

function readConfigContext(cfg: ClusterConfig): string {
  return cfg.context || cfg.Context || readContextName(cfg)
}

function readFileName(cfg: ClusterConfig): string {
  return cfg.fileName || cfg.FileName || ''
}

function sameConfig(a: ClusterConfig, b: ClusterConfig): boolean {
  const aCtx = readConfigContext(a)
  const bCtx = readConfigContext(b)
  const aFile = readFileName(a)
  const bFile = readFileName(b)
  if (aCtx && bCtx && aFile && bFile) return aCtx === bCtx && aFile === bFile
  return readContextName(a) === readContextName(b)
}

/**
 * Hook for getting the current Kubernetes context
 * Fetches context from backend API
 *
 * @example
 * const { context, isLoading, error } = useKubernetesContext()
 * return <span>{context || 'default'}</span>
 */
export function useKubernetesContext() {
  const [context, setContext] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchContext = async () => {
      try {
        setIsLoading(true)
        let configs: ClusterConfig[] = []
        let active: ClusterConfig | null = null

        configs = await getRuntimeClusterConfigs()
        const activeCfg = await getRuntimeActiveClusterConfig()
        active = configs.find((cfg) => sameConfig(cfg, activeCfg)) ?? null

        setContext(active ? readContextName(active) || readConfigContext(active) : pickContextName(configs))
        setError(null)
      } catch (err) {
        console.warn('Failed to fetch Kubernetes context:', err)
        setContext('default')
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }

    void fetchContext()
    const off = Events.On('clusterConfigsChanged', () => {
      void fetchContext()
    })
    return () => {
      off()
    }
  }, [])

  return { context: context || 'default', isLoading, error }
}

/**
 * Hook for polling Kubernetes context (useful for detecting context switches)
 * @param interval - Poll interval in milliseconds (default: 30000ms)
 */
export function useKubernetesContextPolling(interval = 30_000) {
  const [context, setContext] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchContext = async () => {
      try {
        let configs: ClusterConfig[] = []
        let active: ClusterConfig | null = null

        configs = await getRuntimeClusterConfigs()
        const activeCfg = await getRuntimeActiveClusterConfig()
        active = configs.find((cfg) => sameConfig(cfg, activeCfg)) ?? null

        setContext(active ? readContextName(active) || readConfigContext(active) : pickContextName(configs))
      } catch (err) {
        console.warn('Failed to poll context:', err)
      } finally {
        setIsLoading(false)
      }
    }

    // Initial fetch
    fetchContext()

    // Set up polling interval
    const timer = setInterval(fetchContext, interval)

    return () => clearInterval(timer)
  }, [interval])

  return { context: context || 'default', isLoading }
}
