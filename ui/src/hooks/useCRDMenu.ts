import { useEffect, useState } from 'react'
import { CRDGetMenuList } from '../../bindings/kubegui/services/backend'
import type { CRDMenuResponse } from '../../bindings/kubegui/services/models'
import type { CategoryGroup } from '../../bindings/kubegui/internal/resources/crd/models'

export type { CategoryGroup }

interface UseCRDMenuResult {
  /** Sorted list of categories with their resource items. */
  groups: CategoryGroup[]
  /** Quick-access map: category -> "resource1, resource2, ..." */
  uiMap: Record<string, string>
  loading: boolean
  error: string | null
  /** Re-fetch on demand (e.g. after a cluster switch). */
  refetch: () => void
}

interface UseCRDMenuOptions {
  /** Only fetch when true — prevents calls before a cluster is connected. */
  enabled?: boolean
}

function hasWailsBridge(): boolean {
  return typeof window !== 'undefined' && ('__wails' in window || '_wails' in window)
}

export function useCRDMenu({ enabled = true }: UseCRDMenuOptions = {}): UseCRDMenuResult {
  const [data, setData] = useState<CRDMenuResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled || !hasWailsBridge()) return

    let cancelled = false
    setLoading(true)
    setError(null)

    CRDGetMenuList()
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load CRD menu')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, tick])

  return {
    groups: data?.groups ?? [],
    uiMap: (data?.uiMap ?? {}) as Record<string, string>,
    loading,
    error,
    refetch: () => setTick((n) => n + 1),
  }
}