import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ColumnDef, createColumnHelper } from '@tanstack/react-table'
import { Search, ShieldCheck } from 'lucide-react'
import { Select as MantineSelect } from '@mantine/core'
import { AppGetMyPermissions } from '../../../bindings/kubegui/services/backend'
import type { CanIResourceRow } from '../../../bindings/kubegui/internal/cani/models'
import { DataTable } from '@/components/table/DataTable'
import { useNamespaceOptions } from '@/hooks/useNamespaceOptions'

const col = createColumnHelper<CanIResourceRow>()

function VerbBadge({ label, allowed }: { label: string; allowed: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold mr-1 cursor-default select-none ${
        allowed
          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : 'bg-amber-500/10 text-amber-500/40 border border-amber-500/20'
      }`}
    >
      {label}
    </span>
  )
}

const VERBS: { key: keyof CanIResourceRow; label: string }[] = [
  { key: 'get',    label: 'Get'    },
  { key: 'list',   label: 'List'   },
  { key: 'watch',  label: 'Watch'  },
  { key: 'create', label: 'Create' },
  { key: 'update', label: 'Update' },
  { key: 'patch',  label: 'Patch'  },
  { key: 'delete', label: 'Delete' },
]

export function MyPermissionsPage() {
  const [ns, setNs]                     = useState('kube-system')
  const [filter, setFilter]             = useState<'all' | 'allowed' | 'denied'>('all')
  const [globalFilter, setGlobalFilter] = useState('')

  const { options: namespaceOptions } = useNamespaceOptions()

  const { data, status, error } = useQuery<CanIResourceRow[]>({
    queryKey: ['my-permissions', ns],
    queryFn:  () => AppGetMyPermissions(ns),
    staleTime: 30_000,
  })

  const rows = useMemo(() => {
    if (!data) return []
    if (filter === 'allowed') return data.filter(r =>  r.get || r.list || r.watch || r.create || r.update || r.patch || r.delete)
    if (filter === 'denied')  return data.filter(r => !r.get && !r.list && !r.watch && !r.create && !r.update && !r.patch && !r.delete)
    return data
  }, [data, filter])

  // ── Columns — same structure as ResourcesView (select first, then data cols) ──
  const columns = useMemo<ColumnDef<CanIResourceRow, unknown>[]>(() => [
    // 1. Select col — id MUST be 'select' so DataTable renders the "select all" checkbox in <th>
    col.display({
      id: 'select', size: 40, enableSorting: false, header: '',
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    }),

    // 2. Resource — icon + name combined (same as pods name col pattern)
    col.accessor('resource', {
      id: 'resource', header: 'Resource', size: 220,
      cell: (info) => (
        <span className="flex items-center gap-2 min-w-0">
          <img
            src={`/assets/media/icons/${info.getValue<string>()}.svg`}
            alt=""
            style={{ height: 16, flexShrink: 0 }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/assets/media/icons/crd.svg' }}
          />
          <span className="font-medium text-foreground truncate" title={info.getValue<string>()}>
            {info.getValue<string>()}
          </span>
        </span>
      ),
    }),

    // 3. Group
    col.accessor((r) => r.group || 'core', {
      id: 'group', header: 'Group', size: 220,
      cell: (info) => <span className="text-muted-foreground text-sm">{info.getValue<string>()}</span>,
    }),

    // 4. Version
    col.accessor('version', {
      id: 'version', header: 'Version', size: 90,
      cell: (info) => <span className="text-muted-foreground text-sm tabular-nums">{info.getValue<string>()}</span>,
    }),

    // 5. Verbs
    col.display({
      id: 'verbs', header: 'Verbs', enableSorting: false,
      meta: { disableOverflowTooltip: true, allowWrap: true },
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {VERBS.map(({ key, label }) => (
            <VerbBadge key={key} label={label} allowed={!!row.original[key]} />
          ))}
        </span>
      ),
    }),
  ], [])

  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">My Permissions</h3>
          <p className="text-sm text-muted-foreground">RBAC permissions for the current user.</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">Error: {String(error)}</p>}

      {/* Toolbar */}
      <div className="lucid-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-muted-foreground shrink-0" />
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Search permissions…"
                className="lucid-control rounded pl-7 pr-3 py-1 text-[10px] min-w-[200px] focus:outline-none font-label"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label shrink-0" htmlFor="permissions-namespace">Namespace</label>
            <MantineSelect
              id="permissions-namespace"
              value={ns}
              onChange={(value) => setNs(value ?? 'kube-system')}
              data={namespaceOptions.filter(o => o.value !== 'all')}
              size="xs"
              w={220}
              searchable
              allowDeselect={false}
              spellCheck={false}
              classNames={{ input: 'pods-glass-control' }}
              styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
            />
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            {(['all', 'allowed', 'denied'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex items-center gap-1 px-2 py-1 rounded font-bold uppercase tracking-wider transition-colors ${
                  filter === f
                    ? 'bg-primary/20 text-primary rounded-md'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {status === 'pending' ? 'Loading...' : `${rows.length} resources`}
        </span>
      </div>

      {/* Table */}
      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={rows}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={38}
          emptyLabel="No permissions found"
          loading={status === 'pending'}
          defaultSorting={[{ id: 'group', desc: false }, { id: 'resource', desc: false }]}
        />
      </div>
    </div>
  )
}
