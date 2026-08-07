import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Select as MantineSelect } from '@mantine/core'
import { Search } from 'lucide-react'
import { DataTable } from '@/components/table/DataTable'
import { ConfirmDialog } from '@/components/ui/Button'
import { useNamespaceOptions } from '@/hooks/useNamespaceOptions'
import { formatAge } from '@/lib/utils'

type HelmAppRow = {
  name: string
  namespace: string
  revision: number
  chart: string
  appVersion: string
  status: string
  updatedAt: string
}

type HelmRepoOption = { name: string }
type HelmChartOption = { name: string }
type HelmVersionOption = { version: string; appVersion: string }

function statusClass(status: string) {
  const s = status.toLowerCase()
  if (s.includes('deployed') || s.includes('superseded')) return 'text-emerald-400'
  if (s.includes('failed') || s.includes('uninstall')) return 'text-red-400'
  if (s.includes('pending')) return 'text-amber-400'
  return 'text-muted-foreground'
}

export function HelmAppsPage() {
  const { namespaces: namespaceList } = useNamespaceOptions()
  const namespaces = useMemo(() => ['all', ...namespaceList], [namespaceList])
  const [selectedNamespace, setSelectedNamespace] = useState('all')
  const [items, setItems] = useState<HelmAppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [globalFilter, setGlobalFilter] = useState('')
  const [installOpen, setInstallOpen] = useState(false)
  const [installBusy, setInstallBusy] = useState(false)
  const [repos, setRepos] = useState<HelmRepoOption[]>([])
  const [charts, setCharts] = useState<HelmChartOption[]>([])
  const [versions, setVersions] = useState<HelmVersionOption[]>([])
  const [releaseName, setReleaseName] = useState('')
  const [installNamespace, setInstallNamespace] = useState('default')
  const [repoName, setRepoName] = useState('')
  const [chartName, setChartName] = useState('')
  const [chartVersion, setChartVersion] = useState('')
  const [releasePendingDelete, setReleasePendingDelete] = useState<HelmAppRow | null>(null)
  const [uninstallBusy, setUninstallBusy] = useState(false)

  const load = useCallback(async (ns: string) => {
    setLoading(true)
    try {
      const query = ns && ns !== 'all' ? `?namespace=${encodeURIComponent(ns)}` : ''
      const response = await fetch(`/api/v1/helm/apps${query}`)
      if (!response.ok) {
        throw new Error(await response.text())
      }
      const rows = await response.json() as Array<Record<string, unknown>>
      setItems((rows ?? []).map((row) => ({
        name: String(row.name ?? ''),
        namespace: String(row.namespace ?? ''),
        revision: Number(row.revision ?? 0),
        chart: String(row.chart ?? ''),
        appVersion: String(row.appVersion ?? ''),
        status: String(row.status ?? ''),
        updatedAt: String(row.updatedAt ?? ''),
      })))
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load Helm releases')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!namespaces.includes(selectedNamespace)) {
      setSelectedNamespace('all')
      return
    }
    void load(selectedNamespace)
  }, [load, namespaces, selectedNamespace])

  const loadRepos = useCallback(async () => {
    const response = await fetch('/api/v1/helm/repos')
    if (!response.ok) throw new Error(await response.text())
    const rows = await response.json() as Array<Record<string, unknown>>
    const items = rows.map((row) => ({ name: String(row.name ?? '') })).filter((row) => row.name)
    setRepos(items)
    return items
  }, [])

  const loadCharts = useCallback(async (repo: string) => {
    if (!repo) { setCharts([]); return [] as HelmChartOption[] }
    const response = await fetch(`/api/v1/helm/repos/charts?repoName=${encodeURIComponent(repo)}`)
    if (!response.ok) throw new Error(await response.text())
    const rows = await response.json() as Array<Record<string, unknown>>
    const items = rows.map((row) => ({ name: String(row.name ?? '') })).filter((row) => row.name)
    setCharts(items)
    return items
  }, [])

  const loadVersions = useCallback(async (repo: string, chart: string) => {
    if (!repo || !chart) { setVersions([]); return [] as HelmVersionOption[] }
    const response = await fetch(`/api/v1/helm/repos/versions?repoName=${encodeURIComponent(repo)}&chartName=${encodeURIComponent(chart)}`)
    if (!response.ok) throw new Error(await response.text())
    const rows = await response.json() as Array<Record<string, unknown>>
    const items = rows.map((row) => ({
      version: String(row.version ?? ''),
      appVersion: String(row.appVersion ?? ''),
    })).filter((row) => row.version)
    setVersions(items)
    return items
  }, [])

  const openInstallModal = useCallback(async () => {
    setLoadError(null)
    setInstallOpen(true)
    setReleaseName('')
    setChartName('')
    setChartVersion('')
    setCharts([])
    setVersions([])
    const fallbackNS = selectedNamespace !== 'all' ? selectedNamespace : (namespaceList[0] ?? 'default')
    setInstallNamespace(fallbackNS)
    try {
      const repoItems = await loadRepos()
      const firstRepo = repoItems[0]?.name ?? ''
      setRepoName(firstRepo)
      if (!firstRepo) return
      const chartItems = await loadCharts(firstRepo)
      const firstChart = chartItems[0]?.name ?? ''
      setChartName(firstChart)
      if (!firstChart) return
      const versionItems = await loadVersions(firstRepo, firstChart)
      setChartVersion(versionItems[0]?.version ?? '')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load Helm install options')
    }
  }, [loadCharts, loadRepos, loadVersions, namespaceList, selectedNamespace])

  const submitInstall = useCallback(async () => {
    if (installBusy) return
    setInstallBusy(true)
    try {
      const response = await fetch('/api/v1/helm/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseName: releaseName.trim(),
          repoName,
          chartName,
          chartVersion,
          namespace: installNamespace,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      setInstallOpen(false)
      await load(selectedNamespace)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to install Helm app')
    } finally {
      setInstallBusy(false)
    }
  }, [chartName, chartVersion, installBusy, installNamespace, load, releaseName, repoName, selectedNamespace])

  const requestUninstallRelease = useCallback((row: HelmAppRow) => {
    setReleasePendingDelete(row)
  }, [])

  const confirmUninstallRelease = useCallback(async () => {
    if (!releasePendingDelete || uninstallBusy) return
    setUninstallBusy(true)
    try {
      const response = await fetch(`/api/v1/helm/apps?namespace=${encodeURIComponent(releasePendingDelete.namespace)}&name=${encodeURIComponent(releasePendingDelete.name)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await response.text())
      setReleasePendingDelete(null)
      await load(selectedNamespace)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to uninstall Helm app')
    } finally {
      setUninstallBusy(false)
    }
  }, [load, releasePendingDelete, selectedNamespace, uninstallBusy])

  const columns = useMemo<ColumnDef<HelmAppRow>[]>(() => [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      meta: { disableOverflowTooltip: true },
      cell: (info) => <span className="font-label text-sm text-foreground font-semibold">{String(info.getValue())}</span>,
    },
    {
      id: 'namespace',
      header: 'Namespace',
      accessorKey: 'namespace',
      cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue() ?? '—')}</span>,
    },
    {
      id: 'chart',
      header: 'Chart',
      accessorKey: 'chart',
      cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue() ?? '—')}</span>,
    },
    {
      id: 'appVersion',
      header: 'App Version',
      accessorKey: 'appVersion',
      meta: { fixedWidth: 120 },
      cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue() ?? '—')}</span>,
    },
    {
      id: 'revision',
      header: 'Revision',
      accessorKey: 'revision',
      meta: { fixedWidth: 84 },
      cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue() ?? '0')}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      meta: { fixedWidth: 110 },
      cell: (info) => {
        const value = String(info.getValue() ?? 'unknown')
        return <span className={`text-sm font-semibold ${statusClass(value)}`}>{value}</span>
      },
    },
    {
      id: 'updated',
      header: 'Updated',
      accessorFn: (row) => row.updatedAt,
      meta: { fixedWidth: 108 },
      cell: (info) => {
        const value = String(info.getValue() ?? '')
        return <span className="text-sm text-muted-foreground whitespace-nowrap">{value ? `${formatAge(value)} ago` : '—'}</span>
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
              requestUninstallRelease(row)
            }}
            className="text-[11px] px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
        )
      },
    },
  ], [requestUninstallRelease])

  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">Helm Apps</h3>
          <p className="text-sm text-muted-foreground">Installed Helm releases in active cluster.</p>
        </div>
        <button
          type="button"
          onClick={() => { void openInstallModal() }}
          className="h-9 px-3 rounded border border-primary/40 text-primary text-[12px] font-semibold hover:bg-primary/10"
        >
          Install App
        </button>
      </div>

      {loadError && <p className="text-sm text-red-400">Error: {loadError}</p>}

      <div className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible">
        <div className="flex items-center gap-3 flex-wrap overflow-visible">
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label shrink-0" htmlFor="helm-apps-namespace">Namespace</label>
            <MantineSelect
              id="helm-apps-namespace"
              value={selectedNamespace}
              onChange={(value) => setSelectedNamespace(value ?? 'all')}
              data={namespaces.map((n) => ({ value: n, label: n === 'all' ? 'All namespaces' : n }))}
              size="sm"
              w={320}
              searchable
              allowDeselect={false}
              spellCheck={false}
              classNames={{ input: 'pods-glass-control' }}
              styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
            />
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder="Filter releases"
              className="lucid-control rounded pl-6 pr-3 py-1 !text-[13px] !placeholder:text-[13px] min-w-[220px] focus:outline-none font-label"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

        </div>

        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {loading ? 'Loading...' : `${items.length} releases`}
        </span>
      </div>

      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={items}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={38}
          emptyLabel="No Helm releases found."
          loading={loading}
          defaultSorting={[{ id: 'name', desc: false }]}
          persistKey="helm-apps"
          columnOrder={['name', 'namespace', 'chart', 'appVersion', 'revision', 'status', 'updated', 'actions']}
        />
      </div>

      {installOpen && (
        <div className="fixed inset-0 z-[1200] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-[720px] rounded-lg border border-border bg-card p-4 space-y-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Install Helm App</h4>
              <button type="button" onClick={() => setInstallOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
               <div>
                 <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Release Name</label>
                 <input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} className="pods-glass-control rounded px-2 py-1 w-full mt-1 text-[13px]" spellCheck={false} />
               </div>
               <div>
                 <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Namespace</label>
                 <MantineSelect
                   value={installNamespace}
                   onChange={(value) => setInstallNamespace(value ?? 'default')}
                   data={namespaces.filter((n) => n !== 'all').map((n) => ({ value: n, label: n }))}
                   size="sm"
                   searchable
                   allowDeselect={false}
                   classNames={{ input: 'pods-glass-control' }}
                   styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
                 />
               </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Repository</label>
                <MantineSelect
                  value={repoName}
                  onChange={(value) => {
                    const nextRepo = value ?? ''
                    setRepoName(nextRepo)
                    setChartName('')
                    setChartVersion('')
                    setVersions([])
                    void loadCharts(nextRepo).then((items) => {
                      const firstChart = items[0]?.name ?? ''
                      setChartName(firstChart)
                      if (!firstChart) return
                      void loadVersions(nextRepo, firstChart).then((v) => setChartVersion(v[0]?.version ?? ''))
                    }).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Failed to load charts'))
                  }}
                  data={repos.map((r) => ({ value: r.name, label: r.name }))}
                  searchable
                  allowDeselect={false}
                  classNames={{ input: 'pods-glass-control' }}
                  styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Chart</label>
                <MantineSelect
                  value={chartName}
                  onChange={(value) => {
                    const nextChart = value ?? ''
                    setChartName(nextChart)
                    setChartVersion('')
                    void loadVersions(repoName, nextChart).then((v) => setChartVersion(v[0]?.version ?? '')).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Failed to load versions'))
                  }}
                  data={charts.map((c) => ({ value: c.name, label: c.name }))}
                  searchable
                  allowDeselect={false}
                  classNames={{ input: 'pods-glass-control' }}
                  styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Version</label>
                <MantineSelect
                  value={chartVersion}
                  onChange={(value) => setChartVersion(value ?? '')}
                  data={versions.map((v) => ({ value: v.version, label: `${v.version}${v.appVersion ? ` (app ${v.appVersion})` : ''}` }))}
                  searchable
                  allowDeselect={false}
                  classNames={{ input: 'pods-glass-control' }}
                  styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setInstallOpen(false)} className="px-3 py-1 rounded border border-border text-xs text-muted-foreground">Cancel</button>
              <button
                type="button"
                disabled={installBusy || !releaseName.trim() || !installNamespace || !repoName || !chartName || !chartVersion}
                onClick={() => { void submitInstall() }}
                className="px-3 py-1 rounded border border-primary/40 text-xs text-primary font-semibold disabled:opacity-50"
              >
                {installBusy ? 'Installing…' : 'Install'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(releasePendingDelete)}
        title={releasePendingDelete ? `Uninstall Helm release "${releasePendingDelete.name}"?` : 'Uninstall Helm release?'}
        description={releasePendingDelete ? `Release in namespace "${releasePendingDelete.namespace}" will be removed. This will uninstall managed Kubernetes resources for this release.` : undefined}
        confirmLabel={uninstallBusy ? 'Uninstalling…' : 'Uninstall'}
        onConfirm={() => { void confirmUninstallRelease() }}
        onCancel={() => {
          if (uninstallBusy) return
          setReleasePendingDelete(null)
        }}
      />
    </div>
  )
}


