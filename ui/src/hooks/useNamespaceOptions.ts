import { useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Events } from '@wailsio/runtime'
import { ResourceList } from '../../bindings/kubegui/services/backend'

async function fetchNamespaceList(): Promise<string[]> {
  const response = await ResourceList('namespaces', 'all')
  const arr: Array<unknown> = Array.isArray(response) ? response : []
  return arr
    .map((item) => {
      const meta = (item as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined
      return meta?.name
    })
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Custom hook for namespace selector dropdown options.
 * Subscribes to namespacesInformerChanged events for live updates.
 */
export function useNamespaceOptions() {
  const { data: namespaces = [], status, error, refetch } = useQuery({
    queryKey: ['namespaces'],
    queryFn: fetchNamespaceList,
    staleTime: 30_000,
  })

  useEffect(() => {
    const off = Events.On('namespacesInformerChanged', () => { void refetch() })
    return () => { off?.() }
  }, [refetch])

  const options = useMemo(
    () => [
      { value: 'all', label: 'All namespaces' },
      ...namespaces.map((ns) => ({ value: ns, label: ns })),
    ],
    [namespaces],
  )

  return { options, namespaces, status, error: error ? String(error) : null }
}