import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import { DataTable } from '@/components/table/DataTable'
import { ConfirmDialog } from '@/components/ui/Button'

type HelmRepoRow = {
  name: string
  url: string
  chartCount: number
  error: string
}

export function HelmReposPage() {
  const [items, setItems] = useState<HelmRepoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [globalFilter, setGlobalFilter] = useState('')
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoURL, setNewRepoURL] = useState('')
  const [savingRepo, setSavingRepo] = useState(false)
  const [repoPendingDelete, setRepoPendingDelete] = useState<string | null>(null)
  const [deletingRepo, setDeletingRepo] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/helm/repos')
      if (!response.ok) {
        throw new Error(await response.text())
      }
      const rows = await response.json() as Array<Record<string, unknown>>
      setItems((rows ?? []).map((row: Record<string, unknown>) => ({
        name: String(row.name ?? ''),
        url: String(row.url ?? ''),
        chartCount: Number(row.chartCount ?? 0),
        error: String(row.error ?? ''),
      })))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load Helm repositories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const addRepo = useCallback(async () => {
    if (savingRepo) return
    setSavingRepo(true)
    try {
      const response = await fetch('/api/v1/helm/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRepoName.trim(), url: newRepoURL.trim() }),
      })
      if (!response.ok) throw new Error(await response.text())
      setNewRepoName('')
      setNewRepoURL('')
      await load()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to add Helm repository')
    } finally {
      setSavingRepo(false)
    }
  }, [load, newRepoName, newRepoURL, savingRepo])

  const requestRemoveRepo = useCallback((repoName: string) => {
    setRepoPendingDelete(repoName)
  }, [])

  const confirmRemoveRepo = useCallback(async () => {
    if (!repoPendingDelete || deletingRepo) return
    setDeletingRepo(true)
    try {
      const response = await fetch(`/api/v1/helm/repos?name=${encodeURIComponent(repoPendingDelete)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await response.text())
      setRepoPendingDelete(null)
      await load()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to remove Helm repository')
    } finally {
      setDeletingRepo(false)
    }
  }, [deletingRepo, load, repoPendingDelete])

  const columns = useMemo<ColumnDef<HelmRepoRow>[]>(() => [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      meta: { disableOverflowTooltip: true },
      cell: (info) => <span className="font-label text-sm text-foreground font-semibold">{String(info.getValue())}</span>,
    },
    {
      id: 'url',
      header: 'URL',
      accessorKey: 'url',
      cell: (info) => {
        const value = String(info.getValue() ?? '—')
        return <span className="text-sm text-muted-foreground font-mono truncate max-w-[460px] block" title={value}>{value}</span>
      },
    },
    {
      id: 'chartCount',
      header: 'Charts',
      accessorKey: 'chartCount',
      size: 90,
      cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue() ?? 0)}</span>,
    },
    {
      id: 'state',
      header: 'State',
      accessorFn: (row) => row.error ? 'Error' : 'Ready',
      size: 130,
      cell: (info) => {
        const row = info.row.original
        if (row.error) return <span className="text-sm text-amber-400" title={row.error}>Index unavailable</span>
        return <span className="text-sm text-emerald-400">Ready</span>
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      accessorFn: (row) => row.name,
      meta: { fixedWidth: 92 },
      cell: (info) => {
        const row = info.row.original
        return (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              requestRemoveRepo(row.name)
            }}
            className="text-[11px] px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
        )
      },
    },
  ], [requestRemoveRepo])

  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">Helm Repositories</h3>
          <p className="text-sm text-muted-foreground">Configured repositories from local Helm client.</p>
        </div>
      </div>

      {loadError && <p className="text-sm text-red-400">Error: {loadError}</p>}

      <div className="lucid-surface rounded-lg p-3 flex items-end gap-3 flex-wrap">
        <div className="min-w-[180px]">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Repository Name</label>
          <input
            value={newRepoName}
            onChange={(event) => setNewRepoName(event.target.value)}
            className="lucid-control rounded px-2 py-1 w-full mt-1 text-[13px]"
            placeholder="bitnami"
            spellCheck={false}
          />
        </div>
        <div className="min-w-[280px] flex-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Repository URL</label>
          <input
            value={newRepoURL}
            onChange={(event) => setNewRepoURL(event.target.value)}
            className="lucid-control rounded px-2 py-1 w-full mt-1 text-[13px]"
            placeholder="https://charts.bitnami.com/bitnami"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          disabled={savingRepo || !newRepoName.trim() || !newRepoURL.trim()}
          onClick={() => { void addRepo() }}
          className="h-8 px-3 rounded border border-primary/40 text-primary text-[12px] font-semibold disabled:opacity-50 hover:bg-primary/10"
        >
          {savingRepo ? 'Adding…' : 'Add Repo'}
        </button>
      </div>

      <div className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible">
        <div className="flex items-center gap-3 flex-wrap overflow-visible">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder="Filter repositories"
              className="lucid-control rounded pl-6 pr-3 py-1 !text-[13px] !placeholder:text-[13px] min-w-[220px] focus:outline-none font-label"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {loading ? 'Loading...' : `${items.length} repositories`}
        </span>
      </div>

      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={items}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={38}
          emptyLabel="No Helm repositories found."
          loading={loading}
          defaultSorting={[{ id: 'name', desc: false }]}
          persistKey="helm-repos"
          columnOrder={['name', 'url', 'chartCount', 'state', 'actions']}
        />
      </div>

      <ConfirmDialog
        open={Boolean(repoPendingDelete)}
        title={repoPendingDelete ? `Remove Helm repository "${repoPendingDelete}"?` : 'Remove Helm repository?'}
        description="This removes repository from local Helm client configuration. Installed releases stay untouched, but charts from this repo will no longer refresh here."
        confirmLabel={deletingRepo ? 'Removing…' : 'Remove'}
        onConfirm={() => { void confirmRemoveRepo() }}
        onCancel={() => {
          if (deletingRepo) return
          setRepoPendingDelete(null)
        }}
      />
    </div>
  )
}

