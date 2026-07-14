import { useEffect, useState, useCallback, useMemo } from 'react'
import { Events } from '@wailsio/runtime'
import type { ColumnDef } from '@tanstack/react-table'
import { InformerGetCRDDefinitions, ResourceDelete } from '../../../bindings/kubegui/services/backend'
import type { CRDDefinition } from '../../../bindings/kubegui/internal/resources/informers/models'
import { DataTable } from '@/components/table/DataTable'
import { ConfirmDialog } from '@/components/ui/Button'
import { uiNotify } from '@/components/ui/UiNotify'
import { ResourceDrawer } from '@/components/ui/ResourceDrawer'
import { CRDResourcePage } from './CRDResourcePage'
function hasWailsBridge(): boolean {
  return typeof window !== 'undefined' && ('__wails' in window || '_wails' in window)
}type CRDRow = {
  name: string
  group: string
  kind: string
  plural: string
  scope: string
  versions: string
  columns: string
  createdAt: string
  _def: CRDDefinition
}
function toRow(def: CRDDefinition): CRDRow {
  return {
    name: def.name,
    group: def.group,
    kind: def.kind,
    plural: def.plural,
    scope: def.scope,
    versions: def.versions?.join(', ') || '',
    columns: def.columns?.join(', ') || '',
    createdAt: '',
    _def: def,
  }
}

/** Notify the sidebar which item is now active. */
function sidebarNavigateTo(itemId: string, extra?: { group?: string; plural?: string }) {
  window.dispatchEvent(new CustomEvent('sidebarCRDNavigate', { detail: { id: itemId, ...extra } }))
}
export function CRDDefinitionsPage() {
  const [items, setItems] = useState<CRDRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCRD, setSelectedCRD] = useState<CRDDefinition | null>(null)
  const [drawerCRD, setDrawerCRD] = useState<CRDDefinition | null>(null)
  const [globalFilter, setGlobalFilter] = useState('')
  const [selectedRows, setSelectedRows] = useState<CRDRow[]>([])
  const [rowSelectionResetKey, setRowSelectionResetKey] = useState(0)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const load = useCallback(async () => {
    if (!hasWailsBridge()) { setLoading(false); return }
    try {
      const data = await InformerGetCRDDefinitions()
      const sorted = [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
      setItems(sorted.map(toRow))
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load CRD definitions')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  // Auto-refresh on informer event
  useEffect(() => {
    if (!hasWailsBridge()) return
    const off = Events.On('customresourcedefinitionsInformerChanged', () => { void load() })
    const interval = window.setInterval(() => { void load() }, 30000)
    return () => { off(); clearInterval(interval) }
  }, [load])
  const deleteSelected = useCallback(async () => {
    if (selectedRows.length === 0 || bulkDeleteBusy) return
    setBulkDeleteBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedRows.map(async (row) => {
          await ResourceDelete('customresourcedefinitions', '', row.name)
          return row.name
        })
      )
      const deleted: string[] = []
      const failed: string[] = []
      results.forEach((r) => {
        if (r.status === 'fulfilled') deleted.push(r.value)
        else failed.push(r.reason instanceof Error ? r.reason.message : 'Delete failed')
      })
      if (deleted.length > 0) {
        const s = new Set(deleted)
        setItems((prev) => prev.filter((item) => !s.has(item.name)))
      }
      setSelectedRows([])
      setRowSelectionResetKey((n) => n + 1)
      if (failed.length === 0) uiNotify.success(`Deleted ${deleted.length} CRD(s)`)
      else uiNotify.error(`Deleted ${deleted.length}/${selectedRows.length}. ${failed[0]}`)
    } finally {
      setBulkDeleteBusy(false)
    }
  }, [selectedRows, bulkDeleteBusy])
  const columns = useMemo<ColumnDef<CRDRow>[]>(() => [
    {
      id: 'select',
      header: 'select',
      accessorKey: 'name',
      enableSorting: false,
      enableGlobalFilter: false,
      size: 44,
      meta: { thClassName: 'pl-3', tdClassName: 'pl-3' },
      cell: (info) => (
        <input
          type="checkbox"
          className="w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]"
          checked={info.row.getIsSelected()}
          onChange={info.row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      cell: (info) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            const def = info.row.original._def
            setSelectedCRD(def)
            sidebarNavigateTo(`crd-${def.group}-${def.plural}`, { group: def.group, plural: def.plural })
          }}
          className="font-mono text-sm text-primary hover:underline underline-offset-2 font-semibold text-left cursor-pointer"
        >
          {String(info.getValue())}
        </button>
      ),
    },
    {
      id: 'group',
      header: 'Group',
      accessorKey: 'group',
      cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue() || '—')}</span>,
    },
    {
      id: 'kind',
      header: 'Kind',
      accessorKey: 'kind',
      cell: (info) => <span className="text-sm text-foreground/80">{String(info.getValue())}</span>,
    },
    {
      id: 'scope',
      header: 'Scope',
      accessorKey: 'scope',
      cell: (info) => {
        const v = String(info.getValue())
        return (
          <span className={`text-sm font-medium ${v === 'Cluster' ? 'text-sky-400' : 'text-emerald-400'}`}>{v}</span>
        )
      },
    },
    {
      id: 'versions',
      header: 'Versions',
      accessorKey: 'versions',
      cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue() || '—')}</span>,
    },
  ], [])
  const selectedNames = useMemo(
    () => selectedRows.map((r) => r.name).join(', '),
    [selectedRows],
  )
  if (selectedCRD) {
    return (
      <CRDResourcePage
        definition={selectedCRD}
        onNavigateBack={() => { setSelectedCRD(null); sidebarNavigateTo('crd-definitions') }}
      />
    )
  }
  const drawerResource = drawerCRD
    ? { name: drawerCRD.name, namespace: '', kind: 'CustomResourceDefinition', apiVersion: 'apiextensions.k8s.io/v1' }
    : null
  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">CRD Definitions</h3>
          <p className="text-sm text-muted-foreground">Installed CustomResourceDefinitions in the cluster.</p>
        </div>
      </div>
      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}
      <div className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="search"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter CRD definitions..."
            className="lucid-control rounded px-2 py-1.5 text-sm min-w-[220px] focus:outline-none font-label"
            autoComplete="off"
            spellCheck={false}
          />
          {selectedRows.length > 0 && (
            <div className="lucid-control flex items-center gap-1.5 rounded text-sm focus:outline-none px-2 py-1.5 bg-[#0f172a80]">
              <span className="text-[10px] tracking-wider text-muted-foreground max-w-[460px] truncate" title={selectedNames}>
                Selected: {selectedNames}
              </span>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={bulkDeleteBusy}
                className="px-1 py-0 rounded text-[10px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {bulkDeleteBusy ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {loading ? 'Loading…' : `${items.length} definitions`}
        </span>
      </div>
      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={items}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={40}
          emptyLabel="No CRD definitions found."
          columnOrder={['select', 'name', 'group', 'kind', 'scope', 'versions']}
          defaultSorting={[{ id: 'name', desc: false }]}
          persistKey="crd-definitions"
          onSelectedRowsChange={setSelectedRows}
          rowSelectionResetKey={rowSelectionResetKey}
          onRowClick={(row) => setDrawerCRD(row._def)}
        />
      </div>
      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete ${selectedRows.length} CRD(s)?`}
        description={`Selected: ${selectedNames}`}
        confirmLabel={`Delete ${selectedRows.length} CRD(s)`}
        onConfirm={() => { setConfirmDeleteOpen(false); void deleteSelected() }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      {/* CRD Definition detail drawer */}
      <ResourceDrawer
        resource={drawerResource}
        resourceType="customresourcedefinitions"
        onClose={() => setDrawerCRD(null)}
        extraHeaderAction={drawerCRD ? (
          <button
            onClick={() => { setDrawerCRD(null); setSelectedCRD(drawerCRD) }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
          >
            View Resources →
          </button>
        ) : undefined}
      />
    </div>
  )
}
