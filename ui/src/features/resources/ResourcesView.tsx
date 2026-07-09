/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ColumnDef, createColumnHelper } from '@tanstack/react-table'
import { Text } from '@mantine/core'
import { RefreshCw, Search } from 'lucide-react'
import { NamespaceSelect } from '@/components/ui/NamespaceSelect'
import { useQuery } from '@tanstack/react-query'
import { useResourcesStore } from '@/store/useResourcesStore'
import { DataTable } from '@/components/table/DataTable'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useNamespaceOptions } from '@/hooks/useNamespaceOptions'
import { K8sResource } from './types'
import { formatAge, ratioBadge, booleanBadge, eventTypeBadge } from '@/lib/utils'
import { ResourceList } from '../../../bindings/kubegui/services/backend'
import { Events } from '@wailsio/runtime'
import { ResourceDrawer, type ResourceRef } from '@/components/ui/ResourceDrawer'
import { FixedTooltip } from '@/components/ui/FixedTooltip'
import cronstrue from 'cronstrue'

const col = createColumnHelper<K8sResource>()

function getK8sStatus(resource: K8sResource) {
  const phase = resource.status?.phase
  if (phase) return phase
  const conditions = resource.status?.conditions
  if (!conditions || conditions.length === 0) return 'Unknown'
  const ready = conditions.find((c) => c.type === 'Ready')
  if (ready?.status === 'True') return 'Ready'
  if (ready?.status === 'False') return ready.reason ?? 'NotReady'
  return conditions[0]?.type ?? 'Unknown'
}

function statusTextClass(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'true' || normalized.includes('ready') || normalized.includes('running') || normalized.includes('active') || normalized.includes('succeeded') || normalized.includes('available') || normalized.includes('bound') || normalized.includes('completed')) {
    return 'text-emerald-400'
  }
  if (normalized === 'false' || normalized.includes('failed') || normalized.includes('error') || normalized.includes('unavailable') || normalized.includes('notready')) {
    return 'text-red-400'
  }
  return 'text-amber-400'
}

function conditionStatusClass(type: string, status: string): string {
  const normalizedType = type.toLowerCase()
  const normalizedStatus = status.toLowerCase()
  if (normalizedType.includes('allowed') || normalizedType.includes('permitted')) {
    return normalizedStatus === 'true' ? 'text-emerald-400' : 'text-amber-400'
  }
  return statusTextClass(status)
}


function labelBadges(labels: Record<string, string> | undefined) {
  if (!labels) return <span className="text-muted-foreground text-xs">—</span>
  const entries = Object.entries(labels).slice(0, 4)
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-[#354065] text-slate-300 truncate max-w-[160px]" title={`${k}=${v}`}>{k}={v}</span>
      ))}
      {Object.keys(labels).length > 4 && <span className="text-muted-foreground text-xs">+{Object.keys(labels).length - 4}</span>}
    </div>
  )
}

function formatK8sMemory(raw: string | undefined): string {
  if (!raw) return '—'
  const kiMatch = raw.match(/^(\d+)Ki$/)
  if (kiMatch) {
    const ki = parseInt(kiMatch[1])
    if (ki >= 1024 * 1024) return `${(ki / 1024 / 1024).toFixed(1)} GiB`
    if (ki >= 1024) return `${(ki / 1024).toFixed(0)} MiB`
    return `${ki} KiB`
  }
  return raw
}

function subjectsSummary(subjects: Array<{ kind: string; name: string; namespace?: string }> | undefined): string {
  if (!subjects?.length) return '—'
  return subjects.slice(0, 3).map(s => `${s.kind}/${s.name}`).join(', ') + (subjects.length > 3 ? ` +${subjects.length - 3}` : '')
}

export function ResourcesView() {
  const {
    items,
    streamError,
    streamStatus,
    selectedResource,
    selectedNamespace,
    globalFilter,
    setGlobalFilter,
    setSelectedNamespace,
    setStreamStatus,
    setStreamError,
    setItems,
  } = useResourcesStore()

  const [drawerResource, setDrawerResource] = useState<ResourceRef | null>(null)

  const { options: namespaceOptions } = useNamespaceOptions()

  const { status, error, refetch } = useQuery({
    queryKey: ['resources', selectedResource, selectedNamespace],
    queryFn: async () => {
      const data = await ResourceList(selectedResource, selectedNamespace)
      const list: K8sResource[] = Array.isArray(data) ? (data as K8sResource[]) : []
      setItems(list)
      return list
    },
    staleTime: 15_000,
  })

  const load = useCallback(() => { void refetch() }, [refetch])

  // Subscribe to informer events and refresh the list on any change.
  useEffect(() => {
    if (status !== 'success') return
    setStreamStatus('connected')
    setStreamError(null)

    const eventName = `${selectedResource}InformerChanged`
    const off = Events.On(eventName, () => { void refetch() })

    return () => {
      off?.()
      setStreamStatus('idle')
      setStreamError(null)
    }
  }, [selectedNamespace, selectedResource, status, refetch, setStreamStatus, setStreamError])

  const columns = useMemo<ColumnDef<K8sResource, any>[]>(
    () => {
      const xs = 'text-muted-foreground text-xs'
      const xsTrunc = (w: number) => `text-muted-foreground text-xs truncate max-w-[${w}px] block`

      const selectCol = col.display({
        id: 'select', size: 40, enableSorting: false, header: '',
        cell: ({ row }) => (
          <input type="checkbox"
            className="w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]"
            checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />
        ),
      })

      const ageCol = col.accessor((r) => r.metadata.creationTimestamp, {
        id: 'age', header: 'Age', size: 90,
        cell: (info) => <span className="tabular-nums text-muted-foreground">{formatAge(info.getValue<string>())}</span>,
        sortingFn: (a, b) =>
          new Date(a.original.metadata.creationTimestamp ?? 0).getTime() -
          new Date(b.original.metadata.creationTimestamp ?? 0).getTime(),
      })

      const nameCol = col.accessor((r) => r.metadata.name, {
        id: 'name', header: 'Name', size: 300,
        cell: (info) => <span className="font-medium text-foreground truncate max-w-[280px] block" title={info.getValue<string>()}>{info.getValue<string>()}</span>,
      })

      const nsCol = col.accessor((r) => r.metadata.namespace ?? 'cluster', {
        id: 'namespace', header: 'Namespace', size: 160,
        cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
      })

      const statusCol = col.accessor(getK8sStatus, {
        id: 'status', header: 'Status', size: 120,
        cell: (info) => {
          const conditions = (info.row.original.status?.conditions ?? []) as Array<{ type?: string; status?: string }>
          if (conditions.length > 0) {
            return (
              <div className="leading-tight">
                {conditions.map((condition, idx) => {
                  const type = String(condition.type ?? '').trim() || 'Condition'
                  const condStatus = String(condition.status ?? 'Unknown')
                  return (
                    <div key={`${type}-${idx}`} className={`text-xs font-medium ${conditionStatusClass(type, condStatus)}`}>
                      {type}
                    </div>
                  )
                })}
              </div>
            )
          }

          const status = String(info.getValue<string>() || 'Unknown')
          return <span className={`text-xs ${statusTextClass(status)}`}>{status}</span>
        },
      })

      // ── Events: entirely different layout ──────────────────────────────────
      if (selectedResource === 'events') {
        return [
          selectCol,
          nsCol,
          col.accessor((r) => (r as any).lastTimestamp || (r as any).eventTime || r.metadata.creationTimestamp, {
            id: 'last', header: 'Last Seen', size: 140,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{formatAge(info.getValue<string>())}</span>,
            sortingFn: (a, b) =>
              new Date(((a.original as any).lastTimestamp || a.original.metadata.creationTimestamp) ?? 0).getTime() -
              new Date(((b.original as any).lastTimestamp || b.original.metadata.creationTimestamp) ?? 0).getTime(),
          }),
          col.accessor((r) => {
            const inv = (r as any).involvedObject as { kind?: string; name?: string } | undefined
            return inv ? `${inv.kind ?? ''}/${inv.name ?? ''}` : '—'
          }, {
            id: 'object', header: 'Object', size: 240,
            cell: (info) => <span className="text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r as any).type ?? '—', {
            id: 'type', header: 'Type', size: 100,
            meta: { disableOverflowTooltip: true },
            cell: (info) => eventTypeBadge(info.getValue<string>()),
          }),
          col.accessor((r) => (r as any).reason ?? '—', {
            id: 'reason', header: 'Reason', size: 160,
            cell: (info) => <span className="text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r as any).message ?? '—', {
            id: 'message', header: 'Message', size: 400,
            cell: (info) => <span className="text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r as any).count ?? 1, {
            id: 'count', header: 'Count', size: 70,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<number>()}</span>,
          }),
        ]
      }

      // ── Base columns (all namespaced resources) ─────────────────────────────
      const NO_STATUS_RESOURCES = new Set(['daemonsets', 'statefulsets', 'replicasets', 'cronjobs', 'services', 'ingresses'])
      const base: ColumnDef<K8sResource, any>[] = NO_STATUS_RESOURCES.has(selectedResource)
        ? [selectCol, nameCol, nsCol]
        : [selectCol, statusCol, nameCol, nsCol]

      // ── pods ────────────────────────────────────────────────────────────────
      if (selectedResource === 'pods') {
        base.push(
          col.accessor((r) => {
            const owners = (r.metadata as any).ownerReferences as Array<{ kind: string; name: string }> | undefined
            return owners?.length ? `${owners[0].kind}/${owners[0].name}` : r.metadata.name
          }, {
            id: 'controller', header: 'Controller', size: 220,
            cell: (info) => <span className={xsTrunc(200)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => {
            const statuses = (r.status as any)?.containerStatuses as Array<{ name: string; ready: boolean; restartCount?: number; state?: { waiting?: { reason?: string }; running?: object; terminated?: { reason?: string } } }> | undefined
            const initStatuses = (r.status as any)?.initContainerStatuses as typeof statuses | undefined
            return { statuses, initStatuses }
          }, {
            id: 'containers', header: 'Containers', size: 160,
            cell: (info) => {
              const { statuses, initStatuses } = info.getValue<{ statuses: any; initStatuses: any }>()
              const all = [...(initStatuses ?? []), ...(statuses ?? [])]
              if (!all.length) return <span className="text-muted-foreground text-xs">—</span>
              return (
                <div className="flex flex-wrap gap-1 items-center">
                  {all.map((cs: any, i: number) => {
                    const s = cs.state ?? {}
                    const sk = s.running ? 'running' : s.terminated ? 'terminated' : 'waiting'
                    const dot = sk === 'running' && cs.ready ? 'bg-emerald-500'
                      : sk === 'terminated' && cs.state?.terminated?.reason === 'Completed' ? 'bg-emerald-500'
                      : sk === 'waiting' ? 'bg-amber-400' : 'bg-red-500'
                    const tip = sk === 'waiting' ? `${cs.name}: waiting (${cs.state?.waiting?.reason ?? ''}), restarts: ${cs.restartCount ?? 0}`
                      : sk === 'terminated' ? `${cs.name}: ${cs.state?.terminated?.reason ?? 'terminated'}` : `${cs.name}: running`
                    return <span key={i} title={tip} className={`w-2.5 h-2.5 rounded-full inline-block shrink-0 ${dot}`} />
                  })}
                </div>
              )
            },
          }),
          col.accessor((r) => (r.spec as any)?.nodeName ?? '—', {
            id: 'node', header: 'Node', size: 180,
            cell: (info) => <span className={xsTrunc(160)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── deployments ─────────────────────────────────────────────────────────
      if (selectedResource === 'deployments') {
        base.push(
          col.accessor((r) => {
            const ready = (r.status as any)?.readyReplicas ?? 0
            const desired = (r.spec as any)?.replicas ?? 0
            return `${ready}/${desired}`
          }, {
            id: 'replicas', header: 'Replicas', size: 100,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
        )
      }

      // ── statefulsets ────────────────────────────────────────────────────────
      if (selectedResource === 'statefulsets') {
        base.push(
          col.accessor((r) => {
            const ready = (r.status as any)?.readyReplicas ?? 0
            const desired = (r.spec as any)?.replicas ?? 0
            return `${ready}/${desired}`
          }, {
            id: 'pods', header: 'Pods', size: 90,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
          col.accessor((r) => (r.spec as any)?.replicas ?? 0, {
            id: 'replicas', header: 'Replicas', size: 90,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<number>()}</span>,
          }),
        )
      }

      // ── daemonsets ──────────────────────────────────────────────────────────
      if (selectedResource === 'daemonsets') {
        base.push(
          col.accessor((r) => {
            const st = r.status as any
            const ready = st?.numberReady ?? 0
            const desired = st?.desiredNumberScheduled ?? 0
            return `${ready}/${desired}`
          }, {
            id: 'daemons', header: 'Daemons', size: 100,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
          col.accessor((r) => (r.status as any)?.numberAvailable ?? 0, {
            id: 'nodes', header: 'Nodes', size: 80,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<number>()}</span>,
          }),
        )
      }

      // ── replicasets ─────────────────────────────────────────────────────────
      if (selectedResource === 'replicasets') {
        base.push(
          col.accessor((r) => {
            const ready = (r.status as any)?.readyReplicas ?? 0
            const desired = (r.spec as any)?.replicas ?? 0
            return `${ready}/${desired}`
          }, {
            id: 'replicas', header: 'Replicas', size: 100,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
        )
      }

      // ── jobs ────────────────────────────────────────────────────────────────
      if (selectedResource === 'jobs') {
        base.push(
          col.accessor((r) => (r.status as any)?.active ?? 0, {
            id: 'running', header: 'Running', size: 90,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<number>()}</span>,
          }),
          col.accessor((r) => {
            const succeeded = (r.status as any)?.succeeded ?? 0
            const completions = (r.spec as any)?.completions ?? '—'
            return `${succeeded}/${completions}`
          }, {
            id: 'succeeded', header: 'Succeeded/Required', size: 160,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
          col.accessor((r) => {
            const failed = (r.status as any)?.failed ?? 0
            const limit = (r.spec as any)?.backoffLimit ?? '—'
            return `${failed}/${limit}`
          }, {
            id: 'failed', header: 'Failed/Limit', size: 120,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
          col.accessor((r) => (r.spec as any)?.suspend ? 'Yes' : 'No', {
            id: 'suspended', header: 'Suspended', size: 100,
            cell: (info) => booleanBadge(info.getValue<string>() === 'Yes'),
          }),
        )
      }

      // ── cronjobs ────────────────────────────────────────────────────────────
      if (selectedResource === 'cronjobs') {
        base.push(
          col.accessor((r) => (r.spec as any)?.schedule ?? '—', {
            id: 'schedule', header: 'Schedule', size: 160,
            meta: { disableOverflowTooltip: true },
            cell: (info) => {
              const schedule = info.getValue<string>()
              let human = ''
              try {
                human = cronstrue.toString(schedule, { use24HourTimeFormat: true, verbose: true })
              } catch (e) {
                console.warn('[schedule cell] cronstrue failed for:', JSON.stringify(schedule), e)
              }
              console.log('[schedule cell] schedule=', JSON.stringify(schedule), 'human=', human)
              const inner = <span className="tabular-nums text-xs text-muted-foreground font-mono">{schedule}</span>
              return human
                ? <FixedTooltip content={human}>{inner}</FixedTooltip>
                : inner
            },
          }),
          col.accessor((r) => {
            const active = (r.status as any)?.active as unknown[] | undefined
            return active?.length ?? 0
          }, {
            id: 'active', header: 'Active', size: 80,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<number>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.suspend ? 'Yes' : 'No', {
            id: 'suspended', header: 'Suspended', size: 100,
            cell: (info) => booleanBadge(info.getValue<string>() === 'Yes'),
          }),
        )
      }

      // ── services ────────────────────────────────────────────────────────────
      if (selectedResource === 'services') {
        base.push(
          col.accessor((r) => {
            const ports = (r.spec as any)?.ports as Array<{ port: number; targetPort?: number | string; protocol?: string }> | undefined
            if (!ports?.length) return '—'
            return ports.map((p) => `${p.port}${p.targetPort !== undefined ? `:${p.targetPort}` : ''} (${p.protocol ?? 'TCP'})`).join(', ')
          }, {
            id: 'ports', header: 'Ports', size: 200,
            cell: (info) => <span className={xsTrunc(180)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.type ?? '—', {
            id: 'type', header: 'Type', size: 120,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.clusterIP ?? '—', {
            id: 'clusterIP', header: 'ClusterIP', size: 140,
            cell: (info) => <span className="text-muted-foreground text-xs tabular-nums">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => {
            const ips = (r.spec as any)?.externalIPs as string[] | undefined
            const lbIp = (r.status as any)?.loadBalancer?.ingress?.[0]?.ip as string | undefined
            const lbHost = (r.status as any)?.loadBalancer?.ingress?.[0]?.hostname as string | undefined
            return ips?.join(', ') || lbIp || lbHost || '—'
          }, {
            id: 'externalIP', header: 'ExternalIP', size: 160,
            cell: (info) => <span className="text-muted-foreground text-xs tabular-nums truncate max-w-[140px] block" title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── ingresses ───────────────────────────────────────────────────────────
      if (selectedResource === 'ingresses') {
        base.push(
          col.accessor((r) => {
            const ingress = (r.status as any)?.loadBalancer?.ingress as Array<{ ip?: string; hostname?: string }> | undefined
            if (!ingress?.length) return '—'
            return ingress.map(i => i.ip || i.hostname || '').filter(Boolean).join(', ')
          }, {
            id: 'lb', header: 'LoadBalancers', size: 180,
            cell: (info) => <span className={xsTrunc(160)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => {
            const rules = (r.spec as any)?.rules as Array<{ host?: string; http?: { paths: Array<{ path?: string; backend?: unknown }> } }> | undefined
            if (!rules?.length) return '—'
            return rules.map(rule => {
              const paths = rule.http?.paths?.map(p => p.path ?? '/').join(', ') ?? ''
              return rule.host ? `${rule.host}${paths ? ' [' + paths + ']' : ''}` : paths
            }).join('; ')
          }, {
            id: 'rules', header: 'Rules', size: 280,
            cell: (info) => <span className={xsTrunc(260)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── nodes ───────────────────────────────────────────────────────────────
      if (selectedResource === 'nodes') {
        base.push(
          col.accessor((r) => {
            const addrs = (r.status as any)?.addresses as Array<{ type: string; address: string }> | undefined
            return addrs?.find(a => a.type === 'InternalIP')?.address ?? '—'
          }, {
            id: 'ip', header: 'IP', size: 140,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.status as any)?.allocatable?.cpu ?? '—', {
            id: 'cpu', header: 'CPU', size: 90,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => formatK8sMemory((r.status as any)?.allocatable?.memory), {
            id: 'ram', header: 'RAM', size: 100,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => formatK8sMemory((r.status as any)?.allocatable?.['ephemeral-storage']), {
            id: 'disk', header: 'Disk', size: 100,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => {
            const taints = (r.spec as any)?.taints as Array<{ key: string; effect: string; value?: string }> | undefined
            if (!taints?.length) return '—'
            return taints.map(t => `${t.key}:${t.effect}`).join(', ')
          }, {
            id: 'taints', header: 'Taints', size: 200,
            cell: (info) => <span className={xsTrunc(180)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── namespaces ──────────────────────────────────────────────────────────
      if (selectedResource === 'namespaces') {
        base.push(
          col.accessor((r) => r.metadata.labels as Record<string, string> | undefined, {
            id: 'labels', header: 'Labels', size: 300,
            cell: (info) => labelBadges(info.getValue<Record<string, string> | undefined>()),
          }),
        )
      }

      // ── persistentvolumes ───────────────────────────────────────────────────
      if (selectedResource === 'persistentvolumes') {
        base.push(
          col.accessor((r) => (r.spec as any)?.volumeMode ?? '—', {
            id: 'mode', header: 'Mode', size: 100,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.storageClassName ?? '—', {
            id: 'sc', header: 'Storage Class', size: 160,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.capacity?.storage ?? '—', {
            id: 'size', header: 'Size', size: 90,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => {
            const modes = (r.spec as any)?.accessModes as string[] | undefined
            return modes?.join(', ') ?? '—'
          }, {
            id: 'accessModes', header: 'Access Modes', size: 160,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.persistentVolumeReclaimPolicy ?? '—', {
            id: 'reclaimPolicy', header: 'Reclaim Policy', size: 130,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── persistentvolumeclaims ──────────────────────────────────────────────
      if (selectedResource === 'persistentvolumeclaims') {
        base.push(
          col.accessor((r) => (r.spec as any)?.storageClassName ?? '—', {
            id: 'storageClass', header: 'Storage Class', size: 160,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.resources?.requests?.storage ?? '—', {
            id: 'size', header: 'Size', size: 90,
            cell: (info) => <span className="tabular-nums text-xs text-muted-foreground">{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r.spec as any)?.volumeName ?? '—', {
            id: 'volumeName', header: 'Volume Name', size: 180,
            cell: (info) => <span className={xsTrunc(160)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── configmaps ──────────────────────────────────────────────────────────
      if (selectedResource === 'configmaps') {
        base.push(
          col.accessor((r) => {
            const data = (r as any).data as Record<string, unknown> | undefined
            const binaryData = (r as any).binaryData as Record<string, unknown> | undefined
            const count = Object.keys(data ?? {}).length + Object.keys(binaryData ?? {}).length
            const keys = [...Object.keys(data ?? {}), ...Object.keys(binaryData ?? {})].join(', ')
            return { count, keys }
          }, {
            id: 'keys', header: 'Keys', size: 200,
            cell: (info) => {
              const { count, keys } = info.getValue<{ count: number; keys: string }>()
              if (count === 0) return <span className="text-muted-foreground text-xs">—</span>
              return <span className={xsTrunc(180)} title={keys}>{count} key{count !== 1 ? 's' : ''}: {keys}</span>
            },
          }),
        )
      }

      // ── secrets ─────────────────────────────────────────────────────────────
      if (selectedResource === 'secrets') {
        base.push(
          col.accessor((r) => (r as any).type ?? '—', {
            id: 'type', header: 'Type', size: 200,
            cell: (info) => <span className={xsTrunc(180)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => {
            const data = (r as any).data as Record<string, unknown> | undefined
            const count = Object.keys(data ?? {}).length
            return { count, keys: Object.keys(data ?? {}).join(', ') }
          }, {
            id: 'keys', header: 'Keys', size: 160,
            cell: (info) => {
              const { count, keys } = info.getValue<{ count: number; keys: string }>()
              if (count === 0) return <span className="text-muted-foreground text-xs">—</span>
              return <span className={xsTrunc(140)} title={keys}>{count} key{count !== 1 ? 's' : ''}</span>
            },
          }),
        )
      }

      // ── rolebindings ────────────────────────────────────────────────────────
      if (selectedResource === 'rolebindings') {
        base.push(
          col.accessor((r) => subjectsSummary((r as any).subjects), {
            id: 'bindings', header: 'Bindings', size: 280,
            cell: (info) => <span className={xsTrunc(260)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── clusterrolebindings ─────────────────────────────────────────────────
      if (selectedResource === 'clusterrolebindings') {
        base.push(
          col.accessor((r) => subjectsSummary((r as any).subjects), {
            id: 'bindings', header: 'Bindings', size: 280,
            cell: (info) => <span className={xsTrunc(260)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── horizontalpodautoscalers ────────────────────────────────────────────
      if (selectedResource === 'horizontalpodautoscalers') {
        base.push(
          col.accessor((r) => {
            const metrics = (r.spec as any)?.metrics as Array<{ type: string; resource?: { name: string; target?: { averageUtilization?: number; type?: string } } }> | undefined
            if (!metrics?.length) return '—'
            return metrics.map(m => {
              if (m.type === 'Resource' && m.resource) {
                const util = m.resource.target?.averageUtilization
                return `${m.resource.name}${util !== undefined ? `: ${util}%` : ''}`
              }
              return m.type
            }).join(', ')
          }, {
            id: 'metrics', header: 'Metrics', size: 200,
            cell: (info) => <span className={xsTrunc(180)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => {
            const min = (r.spec as any)?.minReplicas ?? '—'
            const max = (r.spec as any)?.maxReplicas ?? '—'
            return `${min}/${max}`
          }, {
            id: 'minMax', header: 'Min/Max Pods', size: 120,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
          col.accessor((r) => {
            const current = (r.status as any)?.currentReplicas ?? 0
            const desired = (r.status as any)?.desiredReplicas ?? 0
            return `${current}/${desired}`
          }, {
            id: 'replicas', header: 'Replicas', size: 100,
            cell: (info) => ratioBadge(info.getValue<string>()),
          }),
        )
      }

      // ── storageclasses ──────────────────────────────────────────────────────
      if (selectedResource === 'storageclasses') {
        base.push(
          col.accessor((r) => (r as any).provisioner ?? '—', {
            id: 'provisioner', header: 'Provisioner', size: 220,
            cell: (info) => <span className={xsTrunc(200)} title={info.getValue<string>()}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r as any).reclaimPolicy ?? '—', {
            id: 'reclaimPolicy', header: 'Reclaim Policy', size: 130,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
          col.accessor((r) => (r as any).volumeBindingMode ?? '—', {
            id: 'volumeBindingMode', header: 'Volume Binding Mode', size: 180,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
        )
      }

      // ── networkpolicies ─────────────────────────────────────────────────────
      if (selectedResource === 'networkpolicies') {
        base.push(
          col.accessor((r) => {
            const types = (r.spec as any)?.policyTypes as string[] | undefined
            return types?.join(', ') ?? '—'
          }, {
            id: 'policyType', header: 'Policy Type', size: 160,
            cell: (info) => <span className={xs}>{info.getValue<string>()}</span>,
          }),
        )
      }

      base.push(ageCol)
      return base
    },

    [selectedResource],
  )

  const streamLabel = useMemo(() => {
    switch (streamStatus) {
      case 'connected': return 'Live stream connected'
      case 'connecting': return 'Connecting to live stream...'
      case 'reconnecting': return 'Reconnecting to live stream...'
      case 'error': return 'Live stream disconnected'
      default: return 'Live stream idle'
    }
  }, [streamStatus])

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-sm">
          <Search size={14} className="text-muted-foreground shrink-0" />
          <Input
            type="search"
            placeholder={`Search ${selectedResource}...`}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="h-7"
          />
        </div>

        <NamespaceSelect
          id="resources-namespace"
          value={selectedNamespace}
          onChange={(value) => setSelectedNamespace(value)}
          options={namespaceOptions}
        />

        <div className="text-xs text-muted-foreground tabular-nums ml-auto">
          {status === 'success' && `${items.length} ${selectedResource}`}
          {status === 'error' && <span className="text-red-400">Error</span>}
        </div>

        <Text size="xs" c="dimmed">{streamLabel}</Text>

        <Button variant="outline" size="sm" onClick={load} disabled={status === 'pending'} className="gap-1.5">
          <RefreshCw size={12} className={status === 'pending' ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm shrink-0">
          {String(error)}
        </div>
      )}

      {streamError && !error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-sm shrink-0">
          {streamError}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <DataTable
          data={items}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={40}
          emptyLabel={selectedResource === 'pods' ? 'Loading…' : `No ${selectedResource} found`}
          loading={status === 'pending' || (selectedResource === 'pods' && items.length === 0 && !error)}
          defaultSorting={selectedResource === 'events' ? [{ id: 'last', desc: true }] : [{ id: 'name', desc: false }]}
          onRowClick={(row) => setDrawerResource({
            uid: row.metadata?.uid,
            name: row.metadata?.name ?? '',
            namespace: row.metadata?.namespace,
            kind: row.kind,
            apiVersion: row.apiVersion,
          })}
        />
      </div>

      <ResourceDrawer
        resource={drawerResource}
        resourceType={selectedResource}
        onClose={() => setDrawerResource(null)}
      />
    </div>
  )
}
