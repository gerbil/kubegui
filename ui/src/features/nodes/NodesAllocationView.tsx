/* eslint-disable react-hooks/exhaustive-deps */
// NodesAllocationView.tsx
// Complete example showing a nodes allocation table implementation
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ColumnDef, createColumnHelper } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { NodeGetAllocation } from '../../../bindings/kubegui/services/backend'
import { DataTable } from '@/components/table/DataTable'
import { Button } from '@/components/ui/Button'
import { ratioBadge, statusBadge, booleanBadge } from '@/lib/utils'
// Type Definition
interface NodeAllocation {
  name: string
  status: string
  unschedulable: boolean
  cpuCapacity: number
  cpuAllocatable: number
  cpuUsed: number
  cpuPercent: number
  memoryCapacity: number
  memoryAllocatable: number
  memoryUsed: number
  memoryPercent: number
  podsCount: number
  podCapacity: number
  podAllocated: number
}
// Utility Functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
function formatMillicores(millicores: number): string {
  if (millicores === 0) return '0m'
  const cores = millicores / 1000
  return cores >= 1 ? `${cores.toFixed(2)}` : `${millicores}m`
}
function getProgressBarColor(percent: number): string {
  if (percent > 80) return 'bg-red-500'
  if (percent > 60) return 'bg-yellow-500'
  return 'bg-blue-500'
}
// ProgressBar Component
function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
        {percent}%
      </span>
    </div>
  )
}
// Main Component
export function NodesAllocationView() {
  const [nodes, setNodes] = useState<NodeAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const loadNodes = useCallback(async () => {
    try {
      setLoading(true)
      const data = await NodeGetAllocation()
      setNodes(Array.isArray(data) ? (data as NodeAllocation[]) : [])
      setError(null)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    } finally {
      setLoading(false)
    }
  }, [])
  // Load nodes on mount and set up auto-refresh
  useEffect(() => {
    loadNodes()
    const interval = setInterval(loadNodes, 10000) // Refresh every 10 seconds
    return () => clearInterval(interval)
  }, [loadNodes])
  // Define table columns
  const col = createColumnHelper<NodeAllocation>()
  const columns = useMemo<ColumnDef<NodeAllocation, unknown>[]>(
    () => [
      col.accessor('name', {
        id: 'name',
        header: 'Node Name',
        size: 200,
        cell: (info) => (
          <span className="font-medium text-foreground">{info.getValue<string>()}</span>
        ),
      }),
      col.accessor('status', {
        id: 'status',
        header: 'Status',
        size: 100,
        cell: (info) => statusBadge(info.getValue<string>()),
      }),
      col.accessor('unschedulable', {
        id: 'cordoned',
        header: 'Schedulable',
        size: 100,
        cell: (info) => booleanBadge(!info.getValue<boolean>()),
      }),
      col.accessor('cpuPercent', {
        id: 'cpu',
        header: 'CPU Usage',
        size: 160,
        cell: (info) => {
          const percent = info.getValue<number>()
          const color = getProgressBarColor(percent)
          const capacity = info.row.original.cpuCapacity
          const used = info.row.original.cpuUsed
          return (
            <div className="flex flex-col gap-1">
              <ProgressBar percent={percent} color={color} />
              <span className="text-xs text-muted-foreground">
                {formatMillicores(used)} / {formatMillicores(capacity)}
              </span>
            </div>
          )
        },
      }),
      col.accessor('memoryPercent', {
        id: 'memory',
        header: 'Memory Usage',
        size: 160,
        cell: (info) => {
          const percent = info.getValue<number>()
          const color = getProgressBarColor(percent)
          const capacity = info.row.original.memoryCapacity
          const used = info.row.original.memoryUsed
          return (
            <div className="flex flex-col gap-1">
              <ProgressBar percent={percent} color={color} />
              <span className="text-xs text-muted-foreground">
                {formatBytes(used)} / {formatBytes(capacity)}
              </span>
            </div>
          )
        },
      }),
      col.accessor((row) => `${row.podsCount}/${row.podCapacity}`, {
        id: 'pods',
        header: 'Pods',
        size: 140,
        cell: (info) => {
          const podsCount = info.row.original.podsCount
          const podCapacity = info.row.original.podCapacity
          const podAllocated = info.row.original.podAllocated
          const color = getProgressBarColor(podAllocated)
          return (
            <div className="flex flex-col gap-1">
              <ProgressBar percent={podAllocated} color={color} />
              {ratioBadge(podsCount, podCapacity)}
            </div>
          )
        },
      }),
    ],
    [],
  )
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
        <h2 className="text-sm font-semibold text-foreground">Nodes Allocation</h2>
        <div className="ml-auto flex items-center gap-2">
          {error && (
            <div className="text-xs text-red-400 max-w-xs truncate">{error}</div>
          )}
          {lastUpdated && !error && (
            <div className="text-xs text-muted-foreground">
              Updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={loadNodes}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw
              size={12}
              className={loading ? 'animate-spin' : ''}
            />
            Refresh
          </Button>
        </div>
      </div>
      {/* Error Alert */}
      {error && !loading && nodes.length === 0 && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}
      {/* Data Table */}
      <div className="flex-1 overflow-hidden">
        {loading && nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading nodes allocation data...
          </div>
        ) : (
          <DataTable
            data={nodes}
            columns={columns}
            estimateSize={50}
            emptyLabel="No nodes found"
          />
        )}
      </div>
    </div>
  )
}
export default NodesAllocationView
