/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { NodeGetAllocation, ResourceList, InformerSubscribeResource, InformerUnsubscribeResource } from '../../bindings/kubegui/services/backend'
import type { ResourceWithMetadata } from '../lib/resourceStream'
import { coalesce } from '../lib/coalesce'

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

export type PodAllocation = {
  uid: string
  name: string
  namespace: string
  category: 'system' | 'daemonset' | 'workload'
  health: 'healthy' | 'warning' | 'failed'
}

export type NodeWorkload = {
  name: string
  ip: string
  instanceType: string
  taints: Array<{ key: string; value: string; effect: string }>
  podCount: number
  workloadPercent: number
  cpuPercent: number
  ramPercent: number
  diskPercent: number
  podAllocations: PodAllocation[]
  warm: boolean
  cordoned: boolean
  drained: boolean
}

type NodeLike = ResourceWithMetadata & {
  metadata: ResourceWithMetadata['metadata'] & {
    creationTimestamp?: string
    labels?: Record<string, string>
  }
  spec?: {
    unschedulable?: boolean
    taints?: Array<{ key?: string; effect?: string; value?: string }>
  }
  status?: {
    addresses?: Array<{ type?: string; address?: string }>
    conditions?: Array<{ type?: string; status?: string }>
    capacity?: { cpu?: string; memory?: string }
    allocatable?: { cpu?: string; memory?: string }
  }
}


function normalizeAllocationCategory(value: string | undefined): PodAllocation['category'] {
  if (value === 'system' || value === 'daemonset' || value === 'workload') return value
  return 'workload'
}

function normalizeAllocationHealth(value: string | undefined): PodAllocation['health'] {
  if (value === 'healthy' || value === 'warning' || value === 'failed') return value
  return 'healthy'
}

function fallbackPodAllocations(nodeName: string, podCount: number): PodAllocation[] {
  if (podCount <= 0) return []

  const systemCount = Math.min(2, podCount)
  const daemonsetCount = Math.min(Math.max(0, Math.round(podCount * 0.15)), Math.max(0, podCount - systemCount))
  const workloadCount = Math.max(0, podCount - systemCount - daemonsetCount)
  const out: PodAllocation[] = []

  for (let i = 0; i < workloadCount; i += 1) {
    out.push({
      uid: `${nodeName}:workload:${i}`,
      name: `workload-${i + 1}`,
      namespace: 'default',
      category: 'workload',
      health: 'healthy',
    })
  }

  for (let i = 0; i < daemonsetCount; i += 1) {
    out.push({
      uid: `${nodeName}:daemonset:${i}`,
      name: `daemonset-${i + 1}`,
      namespace: 'kube-system',
      category: 'daemonset',
      health: 'healthy',
    })
  }

  for (let i = 0; i < systemCount; i += 1) {
    out.push({
      uid: `${nodeName}:system:${i}`,
      name: `system-${i + 1}`,
      namespace: 'kube-system',
      category: 'system',
      health: 'healthy',
    })
  }

  return out
}


function extractArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (Array.isArray(record[key])) return record[key] as T[]
    if (Array.isArray(record.items)) return record.items as T[]
  }
  return []
}


export function useNodeWorkload() {
  const [nodesData, setNodesData] = useState<NodeLike[]>([])
  const [podsCountByNode, setPodsCountByNode] = useState<Map<string, number>>(new Map())
  const [podAllocationsByNode, setPodAllocationsByNode] = useState<Map<string, PodAllocation[]>>(new Map())
  const [nodes, setNodes] = useState<NodeWorkload[]>([])
  const [activeNodes, setActiveNodes] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const parseCPUToMilli = (cpu = '0') => {
    if (cpu.endsWith('m')) {
      const value = Number(cpu.slice(0, -1))
      return Number.isFinite(value) ? value : 0
    }
    const cores = Number(cpu)
    return Number.isFinite(cores) ? Math.round(cores * 1000) : 0
  }

  const parseMemoryToBytes = (memory = '0') => {
    const match = memory.match(/^([0-9]+(?:\.[0-9]+)?)([A-Za-z]+)?$/)
    if (!match) return 0

    const value = Number(match[1])
    if (!Number.isFinite(value)) return 0

    const unit = match[2] ?? ''
    const multipliers: Record<string, number> = {
      Ki: 1024,
      Mi: 1024 ** 2,
      Gi: 1024 ** 3,
      Ti: 1024 ** 4,
      Pi: 1024 ** 5,
      Ei: 1024 ** 6,
      K: 1000,
      M: 1000 ** 2,
      G: 1000 ** 3,
      T: 1000 ** 4,
      P: 1000 ** 5,
      E: 1000 ** 6,
    }

    return Math.round(value * (multipliers[unit] ?? 1))
  }

  const deriveWorkload = (
    nodeItems: NodeLike[],
    podCounts: Map<string, number>,
    podAllocationsMap: Map<string, PodAllocation[]>,
  ) => {
    // Don't clear nodes when raw K8s data hasn't arrived yet.
    // refreshNodesAllocation sets nodes directly from NodeAllocation;
    // deriveWorkload only enriches them with IP/instanceType/taints.
    if (nodeItems.length === 0) return
    const activeNodeNames = new Set(
      nodeItems
        .filter((node) => {
          // A node is "active" if it's not cordoned (can accept workloads)
          const isCordoned =
            node.spec?.unschedulable === true ||
            (node.spec?.taints?.some((t) => t.key === 'node.kubernetes.io/unschedulable') ?? false)
          return !isCordoned
        })
        .map((node) => node.metadata?.name)
        .filter((name): name is string => Boolean(name)),
    )

    const mapped = nodeItems
      .map((node) => {
        const name = node.metadata?.name ?? 'unknown-node'
        const ip =
          node.status?.addresses?.find((a) => a.type === 'InternalIP')?.address ??
          node.status?.addresses?.find((a) => a.type === 'ExternalIP')?.address ??
          node.status?.addresses?.find((a) => a.type === 'Hostname')?.address ??
          node.status?.addresses?.[0]?.address ??
          'n/a'
        const podCount = podCounts.get(name) ?? 0
        const instanceType =
          node.metadata?.labels?.['node.kubernetes.io/instance-type'] ??
          node.metadata?.labels?.['beta.kubernetes.io/instance-type'] ??
          ''

        const cpuCapacity = parseCPUToMilli(node.status?.capacity?.cpu)
        const cpuAllocatable = parseCPUToMilli(node.status?.allocatable?.cpu)
        const cpuPercent = cpuCapacity > 0
          ? Math.max(0, Math.min(100, Math.round(((cpuCapacity - cpuAllocatable) / cpuCapacity) * 100)))
          : 0

        const memoryCapacity = parseMemoryToBytes(node.status?.capacity?.memory)
        const memoryAllocatable = parseMemoryToBytes(node.status?.allocatable?.memory)
        const ramPercent = memoryCapacity > 0
          ? Math.max(0, Math.min(100, Math.round(((memoryCapacity - memoryAllocatable) / memoryCapacity) * 100)))
          : 0

        const workloadPercent = Math.max(cpuPercent, ramPercent)
        const podAllocations = podAllocationsMap.get(name) ?? fallbackPodAllocations(name, podCount)
        // Prefer Kubernetes canonical field; fallback to legacy taint signal when needed.
        const cordoned =
          node.spec?.unschedulable === true ||
          (node.spec?.taints?.some((t) => t.key === 'node.kubernetes.io/unschedulable') ?? false)
        // Treat a cordoned node with no remaining scheduled pods as drained.
        const drained = cordoned && podCount === 0
        const taints = (node.spec?.taints ?? []).map((taint) => ({
          key: taint.key ?? 'taint',
          value: taint.value ?? '',
          effect: taint.effect ?? '',
        }))

        return {
          name,
          ip,
          instanceType,
          taints,
          podCount,
          workloadPercent,
          cpuPercent,
          ramPercent,
          diskPercent: 0,   // filled in by useNodeMetrics overlay
          podAllocations,
          warm: Math.max(workloadPercent, cpuPercent, ramPercent) >= 80,
          cordoned,
          drained,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    setNodes(mapped)
    setActiveNodes(activeNodeNames.size)
  }

  useEffect(() => {
    deriveWorkload(nodesData, podsCountByNode, podAllocationsByNode)
  }, [nodesData, podAllocationsByNode, podsCountByNode])

  const refreshNodesFromInformer = useCallback(async () => {
    await withNetworkActivity('Loading nodes content', async () => {
      const nodesRaw = await ResourceList('nodes', '')
      const nodes = extractArray<NodeLike>(nodesRaw, 'nodes')
      if (nodes.length > 0) {
        setNodesData(nodes)
        setError(null)
      }
    })
  }, [])

  const refreshNodesAllocation = useCallback(async () => {
    await withNetworkActivity('Loading nodes content', async () => {
      const rows = await NodeGetAllocation()
      const next = new Map<string, number>()
      const nextAllocations = new Map<string, PodAllocation[]>()

      // Build NodeWorkload[] directly from NodeAllocation so nodes are visible
      // even before the informer cache has synced (NodeGetAllocation falls back
      // to the live API, so it always returns data).
      const directNodes: NodeWorkload[] = []

      rows.forEach((row) => {
        const nodeName = String(row.name ?? '')
        if (!nodeName) return
        const count = Number(row.podsCount ?? 0)
        const normalizedCount = Number.isFinite(count) ? count : 0
        next.set(nodeName, normalizedCount)

        const parsed = (row.podAllocations ?? []).map((alloc, idx) => ({
          uid: String(alloc.uid ?? `${nodeName}:alloc:${idx}`),
          name: String(alloc.name ?? `pod-${idx + 1}`),
          namespace: String(alloc.namespace ?? 'default'),
          category: normalizeAllocationCategory(alloc.category),
          health: normalizeAllocationHealth(alloc.health),
        }))

        nextAllocations.set(
          nodeName,
          parsed.length > 0 ? parsed : fallbackPodAllocations(nodeName, normalizedCount),
        )

        const cpu = Math.max(0, Math.min(100, Number(row.cpuPercent ?? 0)))
        const ram = Math.max(0, Math.min(100, Number(row.memoryPercent ?? 0)))
        directNodes.push({
          name: nodeName,
          ip: 'n/a',
          instanceType: '',
          taints: [],
          podCount: normalizedCount,
          cpuPercent: cpu,
          ramPercent: ram,
          diskPercent: 0,
          workloadPercent: Math.max(cpu, ram),
          podAllocations: parsed.length > 0 ? parsed : fallbackPodAllocations(nodeName, normalizedCount),
          warm: Math.max(cpu, ram) >= 80,
          cordoned: Boolean(row.unschedulable),
          drained: Boolean(row.unschedulable) && normalizedCount === 0,
        })
      })

      setPodsCountByNode(next)
      setPodAllocationsByNode(nextAllocations)

      if (directNodes.length > 0) {
        // Also update activeNodes count (not cordoned nodes).
        const activeCount = directNodes.filter((n) => !n.cordoned).length
        setActiveNodes(activeCount)

        // Use functional update so we never overwrite enriched nodes (those have
        // real IPs/taints from refreshNodesFromInformer / deriveWorkload).
        // Enriched nodes have ip !== 'n/a'; allocation nodes are the fallback.
        setNodes((prev) => {
          if (prev.length > 0) {
            // Merge: update pod counts & allocations on existing enriched nodes.
            return prev.map((n) => {
              const alloc = directNodes.find((d) => d.name === n.name)
              if (!alloc) return n
              return {
                ...n,
                podCount: alloc.podCount,
                cpuPercent: alloc.cpuPercent || n.cpuPercent,
                ramPercent: alloc.ramPercent || n.ramPercent,
                podAllocations: alloc.podAllocations,
                warm: alloc.warm,
              }
            })
          }
          // No enriched nodes yet — use direct allocation nodes as initial display.
          return directNodes
        })
      }

      setError(null)
    })
  }, [])

  useEffect(() => {
    // Subscribe so nodesInformerChanged / podsInformerChanged events are emitted
    // when the informer cache populates (essential on first load while cache warms).
    // Retry subscription once after a short delay in case the manager wasn't ready yet.
    const subscribe = () => {
      void InformerSubscribeResource('nodes').catch(() => {})
      void InformerSubscribeResource('pods').catch(() => {})
    }
    subscribe()
    const resubTimer = window.setTimeout(subscribe, 2000)

    const fetchInitialData = async () => {
      try {
        await Promise.all([
          refreshNodesFromInformer(),
          refreshNodesAllocation(),
        ])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'fetch error')
      } finally {
        setIsLoading(false)
      }
    }

    void fetchInitialData()

    // Periodic poll for allocation — ensures pods populate even when all
    // event-based triggers are missed (synced fired before mount, queue full, etc).
    const allocationInterval = window.setInterval(() => {
      void refreshNodesAllocation()
    }, 30_000)

    // Coalesce rapid informer events — initial sync emits hundreds of events
    // per resource; one fetch per burst is sufficient.
    const triggerNodes = coalesce(() => { void refreshNodesFromInformer() }, 500)
    const triggerAlloc = coalesce(() => { void refreshNodesAllocation() }, 500)

    const offNodes = Events.On('nodesInformerChanged', triggerNodes)

    const offPods = Events.On('podsInformerChanged', triggerAlloc)

    // Re-fetch everything once the informer caches have fully synced so that
    // any data missed during the warm-up window is picked up immediately.
    // Events.On receives a WailsEvent wrapper — the actual payload is in ev.data.
    const offSynced = Events.On('informerProgress', (ev: unknown) => {
      const stage = (ev as { data?: { stage?: string } })?.data?.stage
      if (stage === 'synced') {
        void fetchInitialData()
      }
    })

    return () => {
      clearTimeout(resubTimer)
      clearInterval(allocationInterval)
      triggerNodes.cancel()
      triggerAlloc.cancel()
      offNodes?.()
      offPods?.()
      offSynced?.()
      void InformerUnsubscribeResource('nodes').catch(() => {})
      void InformerUnsubscribeResource('pods').catch(() => {})
    }
  }, [refreshNodesAllocation, refreshNodesFromInformer])

  return { nodes, activeNodes, isLoading, error }
}
