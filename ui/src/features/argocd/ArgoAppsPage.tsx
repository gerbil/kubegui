import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { createPortal } from 'react-dom'
import { Eye, GitBranch, History, Info, Layers, Pencil, RefreshCw, RotateCw, Search, Square, Trash2, Play, X, GitCompare } from 'lucide-react'
import { DataTable } from '@/components/table/DataTable'
import { ConfirmDialog } from '@/components/ui/Button'
import { NamespaceSelect } from '@/components/ui/NamespaceSelect'
import { UiTooltip } from '@/components/ui/UiTooltip'
import { uiNotify } from '@/components/ui/UiNotify'
import { useNamespaceOptions } from '@/hooks/useNamespaceOptions'
import { formatAge } from '@/lib/utils'
import { ArgoYamlEditor } from './ArgoYamlEditor'

type ArgoApp = {
  name: string
  namespace: string
  project: string
  syncStatus: string
  healthStatus: string
  repoUrl: string
  path: string
  chart: string
  targetRevision: string
  syncedRevision: string
  destServer: string
  destName: string
  destNamespace: string
  autoSync: boolean
  sourceCount: number
  operationPhase: string
  reconciledAt: string
  createdAt: string
}

type AnyObj = Record<string, any>
type DetailTab = 'summary' | 'resources' | 'history' | 'diff' | 'yaml'
type DeleteMode = 'foreground' | 'background' | 'orphan'

const NEW_APP_TEMPLATE = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: guestbook
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    targetRevision: HEAD
    path: guestbook
  destination:
    server: https://kubernetes.default.svc
    namespace: guestbook
  syncPolicy:
    syncOptions:
      - CreateNamespace=true
    # automated:
    #   prune: true
    #   selfHeal: true
`

const SYNC_STATUSES = ['Synced', 'OutOfSync', 'Unknown']
const HEALTH_STATUSES = ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown']

function syncClass(status: string) {
  if (status === 'Synced') return 'text-emerald-400'
  if (status === 'OutOfSync') return 'text-amber-400'
  return 'text-muted-foreground'
}

function healthClass(status: string) {
  switch (status) {
    case 'Healthy': return 'text-emerald-400'
    case 'Progressing': return 'text-sky-400'
    case 'Degraded': return 'text-red-400'
    case 'Suspended': return 'text-purple-400'
    case 'Missing': return 'text-amber-400'
    default: return 'text-muted-foreground'
  }
}

function phaseClass(phase: string) {
  if (phase === 'Succeeded') return 'text-emerald-400'
  if (phase === 'Failed' || phase === 'Error') return 'text-red-400'
  if (phase === 'Running' || phase === 'Terminating') return 'text-sky-400'
  return 'text-muted-foreground'
}

function shortRev(rev?: string) {
  if (!rev) return '—'
  return /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error((await response.text()) || response.statusText)
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

function post(url: string, body: unknown) {
  return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function errMsg(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function destLabel(app: ArgoApp) {
  const cluster = app.destName || app.destServer || '—'
  return `${cluster} / ${app.destNamespace || '—'}`
}

const btnBase = 'h-8 px-3 rounded border text-[12px] font-semibold disabled:opacity-50'
const btnPrimary = `${btnBase} border-primary/40 text-primary hover:bg-primary/10`
const btnNeutral = `${btnBase} border-border text-foreground hover:bg-white/5`
const btnDanger = `${btnBase} border-red-500/40 text-red-400 hover:bg-red-500/10`

function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[1100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-[1100px]' : 'max-w-[720px]'} max-h-[90vh] flex flex-col rounded-lg border border-border bg-card p-4 gap-3`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">{title}</h4>
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
      {hint && (
        <UiTooltip content={hint} side="right">
          <span className="text-muted-foreground hover:text-foreground inline-flex" onClick={(event) => event.preventDefault()}>
            <Info size={13} />
          </span>
        </UiTooltip>
      )}
    </label>
  )
}

function StatTile({ label, value, active, className, onClick }: { label: string; value: number; active: boolean; className: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`lucid-surface rounded-lg px-4 py-2 text-left min-w-[110px] border ${active ? 'border-primary/60' : 'border-transparent'}`}
    >
      <div className={`text-xl font-bold ${className}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </button>
  )
}

export function ArgoAppsPage() {
  const { namespaces: namespaceList } = useNamespaceOptions()
  const namespaces = useMemo(() => ['all', ...namespaceList], [namespaceList])
  const [selectedNamespace, setSelectedNamespace] = useState('all')
  const [items, setItems] = useState<ArgoApp[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [globalFilter, setGlobalFilter] = useState('')
  const [syncFilter, setSyncFilter] = useState('')
  const [healthFilter, setHealthFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<{ namespace: string; name: string } | null>(null)

  const load = useCallback(async (ns: string, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const query = ns && ns !== 'all' ? `?namespace=${encodeURIComponent(ns)}` : ''
      const rows = await api<ArgoApp[]>(`/api/v1/argocd/apps${query}`)
      setItems(rows ?? [])
      setLoadError(null)
    } catch (error) {
      const msg = errMsg(error, 'Failed to load Argo CD applications')
      setLoadError(/could not find the requested resource|no matches for kind/i.test(msg)
        ? 'Argo CD is not installed in this cluster (Application CRD not found).'
        : msg)
      setItems([])
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

  // Argo CD apps change state continuously, so keep the list live.
  useEffect(() => {
    const timer = window.setInterval(() => { void load(selectedNamespace, true) }, 5000)
    return () => window.clearInterval(timer)
  }, [load, selectedNamespace])

  const projects = useMemo(() => Array.from(new Set(items.map((i) => i.project))).sort(), [items])

  const filtered = useMemo(() => items.filter((i) =>
    (!syncFilter || i.syncStatus === syncFilter)
    && (!healthFilter || i.healthStatus === healthFilter)
    && (!projectFilter || i.project === projectFilter)), [healthFilter, items, projectFilter, syncFilter])

  const count = (pred: (i: ArgoApp) => boolean) => items.filter(pred).length

  const columns = useMemo<ColumnDef<ArgoApp>[]>(() => [
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'name',
      meta: { disableOverflowTooltip: true },
      cell: (info) => <span className="font-label text-sm text-foreground font-semibold">{String(info.getValue())}</span>,
    },
    { id: 'namespace', header: 'Namespace', accessorKey: 'namespace', cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue())}</span> },
    { id: 'project', header: 'Project', accessorKey: 'project', cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue())}</span> },
    {
      id: 'sync',
      header: 'Sync',
      accessorFn: (row) => row.syncStatus,
      cell: (info) => {
        const row = info.row.original
        return (
          <span className={`text-sm font-medium ${syncClass(row.syncStatus)}`}>
            {row.syncStatus}
            {row.operationPhase === 'Running' && <span className="ml-1 text-sky-400">(syncing)</span>}
          </span>
        )
      },
    },
    { id: 'health', header: 'Health', accessorFn: (row) => row.healthStatus, cell: (info) => <span className={`text-sm font-medium ${healthClass(String(info.getValue()))}`}>{String(info.getValue())}</span> },
    {
      id: 'source',
      header: 'Source',
      accessorFn: (row) => `${row.repoUrl} ${row.path || row.chart}`,
      cell: (info) => {
        const row = info.row.original
        const extra = row.sourceCount > 1 ? ` (+${row.sourceCount - 1})` : ''
        return <span className="text-sm text-muted-foreground">{row.repoUrl.replace(/^https?:\/\//, '')}{row.path ? ` · ${row.path}` : row.chart ? ` · ${row.chart}` : ''}{extra}</span>
      },
    },
    {
      id: 'revision',
      header: 'Revision',
      accessorFn: (row) => row.syncedRevision,
      meta: { fixedWidth: 130 },
      cell: (info) => {
        const row = info.row.original
        return <span className="text-sm text-muted-foreground font-mono">{row.targetRevision || 'HEAD'} @ {shortRev(row.syncedRevision)}</span>
      },
    },
    { id: 'destination', header: 'Destination', accessorFn: (row) => destLabel(row), cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue())}</span> },
    { id: 'autoSync', header: 'Auto-sync', accessorFn: (row) => (row.autoSync ? 'on' : 'off'), meta: { fixedWidth: 90 }, cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue())}</span> },
    {
      id: 'age',
      header: 'Age',
      accessorFn: (row) => row.createdAt,
      meta: { fixedWidth: 90 },
      cell: (info) => <span className="text-sm text-muted-foreground whitespace-nowrap">{formatAge(String(info.getValue() ?? ''))}</span>,
    },
  ], [])

  const toggleSync = (value: string) => setSyncFilter(syncFilter === value ? '' : value)
  const toggleHealth = (value: string) => setHealthFilter(healthFilter === value ? '' : value)

  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">Argo CD Applications</h3>
          <p className="text-sm text-muted-foreground">Applications managed by Argo CD in the active cluster. Click a row for details, sync and diff.</p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className={`${btnPrimary} h-9`}>
          New App
        </button>
      </div>

      {loadError && <p className="text-sm text-red-400">Error: {loadError}</p>}

      <div className="flex gap-3 flex-wrap">
        <StatTile label="Total" value={items.length} active={!syncFilter && !healthFilter} className="text-foreground" onClick={() => { setSyncFilter(''); setHealthFilter('') }} />
        <StatTile label="Synced" value={count((i) => i.syncStatus === 'Synced')} active={syncFilter === 'Synced'} className="text-emerald-400" onClick={() => toggleSync('Synced')} />
        <StatTile label="OutOfSync" value={count((i) => i.syncStatus === 'OutOfSync')} active={syncFilter === 'OutOfSync'} className="text-amber-400" onClick={() => toggleSync('OutOfSync')} />
        <StatTile label="Healthy" value={count((i) => i.healthStatus === 'Healthy')} active={healthFilter === 'Healthy'} className="text-emerald-400" onClick={() => toggleHealth('Healthy')} />
        <StatTile label="Progressing" value={count((i) => i.healthStatus === 'Progressing')} active={healthFilter === 'Progressing'} className="text-sky-400" onClick={() => toggleHealth('Progressing')} />
        <StatTile label="Degraded" value={count((i) => i.healthStatus === 'Degraded')} active={healthFilter === 'Degraded'} className="text-red-400" onClick={() => toggleHealth('Degraded')} />
      </div>

      <div className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible">
        <div className="flex items-center gap-3 flex-wrap overflow-visible">
          <NamespaceSelect
            id="argocd-apps-namespace"
            value={selectedNamespace}
            onChange={setSelectedNamespace}
            options={namespaces.map((n) => ({ value: n, label: n === 'all' ? 'All namespaces' : n }))}
          />
          <select value={syncFilter} onChange={(e) => setSyncFilter(e.target.value)} className="lucid-control rounded px-2 py-1 text-[13px]">
            <option value="">Any sync status</option>
            {SYNC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="lucid-control rounded px-2 py-1 text-[13px]">
            <option value="">Any health</option>
            {HEALTH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="lucid-control rounded px-2 py-1 text-[13px]">
            <option value="">Any project</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder="Filter applications"
              className="lucid-control rounded pl-6 pr-3 py-1 !text-[13px] min-w-[220px] focus:outline-none font-label"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {loading ? 'Loading...' : `${filtered.length} applications`}
        </span>
      </div>

      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={filtered}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={38}
          emptyLabel="No Argo CD applications found."
          loading={loading}
          defaultSorting={[{ id: 'name', desc: false }]}
          persistKey="argocd-apps"
          columnOrder={['name', 'namespace', 'project', 'sync', 'health', 'source', 'revision', 'destination', 'autoSync', 'age']}
          onRowClick={(row: ArgoApp) => setSelected({ namespace: row.namespace, name: row.name })}
        />
      </div>

      {createOpen && (
        <CreateAppDrawer
          initialYaml={NEW_APP_TEMPLATE}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (yaml) => {
            const created = await post('/api/v1/argocd/apps', { yaml }) as { name: string; namespace: string }
            setCreateOpen(false)
            await load(selectedNamespace, true)
            setSelected({ namespace: created.namespace, name: created.name })
          }}
        />
      )}

      {selected && (
        <AppDetailModal
          key={`${selected.namespace}/${selected.name}`}
          namespace={selected.namespace}
          name={selected.name}
          onClose={() => setSelected(null)}
          onChanged={() => load(selectedNamespace, true)}
        />
      )}
    </div>
  )
}

function CreateAppDrawer({ initialYaml, onSubmit, onClose }: {
  initialYaml: string
  onSubmit: (yaml: string) => Promise<void>
  onClose: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return createPortal(
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[999] transition-opacity duration-200 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New Argo CD Application"
        className={`fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[760px] max-w-[100vw] z-[1000] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <GitBranch size={15} className="text-primary shrink-0" />
              <span className="font-mono text-sm font-bold text-foreground">New Argo CD Application</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">Edit the YAML manifest and click Create</p>
          </div>
          <UiTooltip content="Close panel" side="bottom">
            <button type="button" aria-label="Close panel" onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
              <X size={18} />
            </button>
          </UiTooltip>
        </div>
        <div className="flex-1 min-h-0 p-4 flex flex-col">
          <ArgoYamlEditor initialYaml={initialYaml} onSubmit={onSubmit} submitLabel="Create Application" mode="create" onCancel={onClose} />
        </div>
      </div>
    </>,
    document.body,
  )
}

function AppDetailModal({ namespace, name, onClose, onChanged }: {
  namespace: string
  name: string
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [app, setApp] = useState<AnyObj | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('summary')
  const [syncOpen, setSyncOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<AnyObj | null>(null)
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const base = `namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`

  const reload = useCallback(async () => {
    try {
      setApp(await api<AnyObj>(`/api/v1/argocd/apps/detail?${base}`))
      setError(null)
    } catch (e) {
      const msg = errMsg(e, 'Failed to load application')
      if (/not found/i.test(msg)) setGone(true)
      setError(msg)
    }
  }, [base])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => { void reload() }, 3000)
    return () => window.clearInterval(timer)
  }, [reload])

  const run = useCallback(async (label: string, action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      uiNotify.success(label)
      await reload()
      await onChanged()
    } catch (e) {
      const msg = errMsg(e, `${label} failed`)
      setError(msg)
      uiNotify.error(msg)
    } finally {
      setBusy(false)
    }
  }, [onChanged, reload])

  const status: AnyObj = app?.status ?? {}
  const spec: AnyObj = app?.spec ?? {}
  const syncStatus = String(status.sync?.status ?? 'Unknown')
  const healthStatus = String(status.health?.status ?? 'Unknown')
  const opState: AnyObj | undefined = status.operationState
  const running = opState?.phase === 'Running'
  const resources: AnyObj[] = Array.isArray(status.resources) ? status.resources : []
  const history: AnyObj[] = Array.isArray(status.history) ? [...status.history].reverse() : []
  const autoSync = !!spec.syncPolicy?.automated
  const sources: AnyObj[] = Array.isArray(spec.sources) ? spec.sources : spec.source ? [spec.source] : []
  const conditions: AnyObj[] = Array.isArray(status.conditions) ? status.conditions : []

  const tabs: { id: DetailTab; label: string; icon: ReactNode }[] = [
    { id: 'summary', label: 'Summary', icon: <Eye size={13} /> },
    { id: 'resources', label: `Resources (${resources.length})`, icon: <Layers size={13} /> },
    { id: 'history', label: `History (${history.length})`, icon: <History size={13} /> },
    { id: 'diff', label: 'Diff', icon: <GitCompare size={13} /> },
    { id: 'yaml', label: 'YAML', icon: <Pencil size={13} /> },
  ]

  const drawer = (
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[999] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[860px] max-w-[100vw] z-[1000] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <GitBranch size={15} className="text-primary shrink-0" />
              <span className="font-mono text-sm font-bold text-foreground truncate">{name}</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              <span>{namespace}</span> &nbsp;·&nbsp;
              <span className={syncClass(syncStatus)}>{syncStatus}</span> &nbsp;·&nbsp;
              <span className={healthClass(healthStatus)}>{healthStatus}</span>
            </p>
          </div>
          <UiTooltip content="Close panel" side="bottom">
            <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
              <X size={18} />
            </button>
          </UiTooltip>
        </div>

        <div className="flex items-center gap-0 border-b border-border bg-accent/10 px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-2 py-2">
            <ActionBtn icon={<Play size={13} />} label="Sync" onClick={() => setSyncOpen(true)} disabled={busy || !app || gone} primary />
            <ActionBtn icon={<RefreshCw size={13} />} label="Refresh" onClick={() => { void run('Refresh requested', () => post('/api/v1/argocd/apps/refresh', { namespace, name, hard: false })) }} disabled={busy || !app || gone} />
            <ActionBtn icon={<RotateCw size={13} />} label="Hard Refresh" onClick={() => { void run('Hard refresh requested', () => post('/api/v1/argocd/apps/refresh', { namespace, name, hard: true })) }} disabled={busy || !app || gone} />
            {running && (
              <ActionBtn icon={<Square size={13} />} label="Terminate" onClick={() => { void run('Termination requested', () => post('/api/v1/argocd/apps/terminate', { namespace, name })) }} disabled={busy} danger />
            )}
            <ActionBtn icon={<Trash2 size={13} />} label="Delete" onClick={() => setDeleteOpen(true)} disabled={busy || !app || gone} danger />
          </div>
        </div>

        {error && <p className="px-5 pt-3 text-sm text-red-400 whitespace-pre-wrap">Error: {error}</p>}

        <div className="flex-1 min-h-0 overflow-auto p-5">
        {!app && !error && <p className="text-sm text-muted-foreground">Loading...</p>}

        {app && tab === 'summary' && (
          <div className="space-y-4 text-[13px]">
            <dl className="grid grid-cols-[160px_1fr] gap-y-1.5">
              <dt className="text-muted-foreground">Project</dt><dd>{spec.project ?? 'default'}</dd>
              <dt className="text-muted-foreground">Destination</dt><dd>{spec.destination?.name || spec.destination?.server || '—'} / {spec.destination?.namespace || '—'}</dd>
              <dt className="text-muted-foreground">Auto-sync</dt>
              <dd>{autoSync ? `enabled${spec.syncPolicy.automated.prune ? ', prune' : ''}${spec.syncPolicy.automated.selfHeal ? ', self-heal' : ''}` : 'disabled'}</dd>
              <dt className="text-muted-foreground">Synced revision</dt>
              <dd className="font-mono">{status.sync?.revision ?? (Array.isArray(status.sync?.revisions) ? status.sync.revisions.map(shortRev).join(', ') : '—')}</dd>
              <dt className="text-muted-foreground">Last reconciled</dt><dd>{status.reconciledAt ? `${formatAge(String(status.reconciledAt))} ago` : '—'}</dd>
              {status.health?.message && (<><dt className="text-muted-foreground">Health message</dt><dd>{String(status.health.message)}</dd></>)}
            </dl>

            <div>
              <h5 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Sources</h5>
              {sources.map((src, idx) => (
                <div key={idx} className="lucid-surface rounded p-2 mb-1 font-mono text-[12px]">
                  {String(src.repoURL ?? '')} · {String(src.path ?? src.chart ?? '')} · {String(src.targetRevision ?? 'HEAD')}
                </div>
              ))}
            </div>

            {opState && (
              <div>
                <h5 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Last operation</h5>
                <div className="lucid-surface rounded p-2">
                  <span className={`font-semibold ${phaseClass(String(opState.phase))}`}>{String(opState.phase)}</span>
                  {opState.startedAt && <span className="text-muted-foreground"> · started {formatAge(String(opState.startedAt))} ago</span>}
                  {opState.message && <div className="text-muted-foreground mt-1 whitespace-pre-wrap">{String(opState.message)}</div>}
                </div>
              </div>
            )}

            {conditions.length > 0 && (
              <div>
                <h5 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Conditions</h5>
                {conditions.map((c, idx) => (
                  <div key={idx} className="lucid-surface rounded p-2 mb-1">
                    <span className="text-amber-400 font-semibold">{String(c.type)}</span>
                    <div className="text-muted-foreground whitespace-pre-wrap">{String(c.message ?? '')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {app && tab === 'resources' && <ResourcesTable resources={resources} />}

        {app && tab === 'history' && (
          <table className="w-full text-[13px]">
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-1">ID</th><th>Deployed</th><th>Revision</th><th /></tr>
            </thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={4} className="py-3 text-muted-foreground">No deployment history.</td></tr>}
              {history.map((h) => (
                <tr key={String(h.id)} className="border-t border-border/50">
                  <td className="py-1.5">{String(h.id)}</td>
                  <td>{h.deployedAt ? `${formatAge(String(h.deployedAt))} ago` : '—'}</td>
                  <td className="font-mono">{h.revision ? shortRev(String(h.revision)) : Array.isArray(h.revisions) ? h.revisions.map(shortRev).join(', ') : '—'}</td>
                  <td className="text-right">
                    <button type="button" disabled={busy} onClick={() => setRollbackTarget(h)} className={`${btnNeutral} !h-7`}>Rollback</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {app && tab === 'diff' && <DiffView base={base} />}

        {app && tab === 'yaml' && (
          <YamlTab base={base} onSaved={() => run('Application updated', async () => undefined)} />
        )}
        </div>
      </div>

      {syncOpen && (
        <SyncModal
          resources={resources}
          autoSync={autoSync}
          appOptions={Array.isArray(spec.syncPolicy?.syncOptions) ? spec.syncPolicy.syncOptions : []}
          onClose={() => setSyncOpen(false)}
          onSubmit={async (opts) => {
            setSyncOpen(false)
            await run(opts.dryRun ? 'Dry-run sync started' : 'Sync started', () => post('/api/v1/argocd/apps/sync', { namespace, name, ...opts }))
          }}
        />
      )}

      <ConfirmDialog
        open={rollbackTarget !== null}
        title="Rollback application"
        description={`Roll ${name} back to deployment #${String(rollbackTarget?.id ?? '')}? Auto-sync must be disabled.`}
        confirmLabel="Rollback"
        onCancel={() => setRollbackTarget(null)}
        onConfirm={() => {
          const id = Number(rollbackTarget?.id)
          setRollbackTarget(null)
          void run('Rollback started', () => post('/api/v1/argocd/apps/rollback', { namespace, name, id, prune: false }))
        }}
      />

      {deleteOpen && (
        <DeleteModal
          name={name}
          onClose={() => setDeleteOpen(false)}
          onConfirm={async (mode) => {
            setDeleteOpen(false)
            setBusy(true)
            try {
              await api(`/api/v1/argocd/apps?${base}&mode=${mode}`, { method: 'DELETE' })
              await onChanged()
              onClose()
            } catch (e) {
              setError(errMsg(e, 'Delete failed'))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(drawer, document.body)
}

function ActionBtn({ icon, label, onClick, disabled = false, danger = false, primary = false }: {
  icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; primary?: boolean
}) {
  const tone = danger
    ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
    : primary
      ? 'border-primary/40 text-primary hover:bg-primary/10'
      : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/60'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tone}`}
    >
      {icon}{label}
    </button>
  )
}

function ResourcesTable({ resources }: { resources: AnyObj[] }) {
  const [filter, setFilter] = useState('')
  const rows = resources.filter((r) => `${r.kind} ${r.name} ${r.namespace ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="space-y-2">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter resources"
        className="lucid-control rounded px-2 py-1 text-[13px] w-64"
        spellCheck={false}
      />
      <table className="w-full text-[13px]">
        <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr><th className="py-1">Kind</th><th>Name</th><th>Namespace</th><th>Sync</th><th>Health</th><th>Message</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-muted-foreground">No resources.</td></tr>}
          {rows.map((r, idx) => (
            <tr key={idx} className="border-t border-border/50 align-top">
              <td className="py-1.5">{String(r.group ? `${r.kind}.${r.group}` : r.kind)}</td>
              <td className="font-semibold">{String(r.name)}</td>
              <td className="text-muted-foreground">{String(r.namespace ?? '—')}</td>
              <td className={syncClass(String(r.status ?? 'Unknown'))}>{String(r.status ?? 'Unknown')}</td>
              <td className={healthClass(String(r.health?.status ?? 'Unknown'))}>{String(r.health?.status ?? '—')}</td>
              <td className="text-muted-foreground">{String(r.health?.message ?? '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffView({ base }: { base: string }) {
  const [state, setState] = useState<{ loading: boolean; error?: string; diff?: string; changed?: boolean }>({ loading: true })

  const load = useCallback(async () => {
    setState({ loading: true })
    try {
      const res = await api<{ diff: string; changed: boolean }>(`/api/v1/argocd/apps/diff?${base}`)
      setState({ loading: false, diff: res.diff, changed: res.changed })
    } catch (e) {
      setState({ loading: false, error: errMsg(e, 'Failed to compute diff') })
    }
  }, [base])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => { void load() }} disabled={state.loading} className={`${btnNeutral} !h-7`}>Re-run diff</button>
        <span className="text-[11px] text-muted-foreground">Uses the local <code>argocd</code> CLI (core mode) against the active cluster.</span>
      </div>
      {state.loading && <p className="text-sm text-muted-foreground">Computing diff...</p>}
      {state.error && <p className="text-sm text-red-400 whitespace-pre-wrap">{state.error}</p>}
      {!state.loading && !state.error && !state.changed && <p className="text-sm text-emerald-400">No differences: live state matches desired state.</p>}
      {state.changed && (
        <pre className="lucid-surface rounded p-3 font-mono text-[12px] leading-5 overflow-auto">
          {(state.diff ?? '').split('\n').map((line, idx) => {
            const cls = line.startsWith('<') ? 'text-red-400' : line.startsWith('>') ? 'text-emerald-400' : /^\d/.test(line) || line.startsWith('===') ? 'text-sky-400' : ''
            return <div key={idx} className={cls}>{line || ' '}</div>
          })}
        </pre>
      )}
    </div>
  )
}

function YamlTab({ base, onSaved }: { base: string; onSaved: () => void | Promise<void> }) {
  const [yaml, setYaml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api<{ yaml: string }>(`/api/v1/argocd/apps/yaml?${base}`)
      .then((res) => { if (!cancelled) setYaml(res.yaml) })
      .catch((e) => { if (!cancelled) setError(errMsg(e, 'Failed to load YAML')) })
    return () => { cancelled = true }
  }, [base])

  if (yaml === null) return error ? <p className="text-sm text-red-400">{error}</p> : <p className="text-sm text-muted-foreground">Loading...</p>
  return (
    <ArgoYamlEditor
      initialYaml={yaml}
      mode="edit"
      submitLabel="Save Changes"
      onSubmit={async (value) => {
        await api('/api/v1/argocd/apps', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yaml: value }) })
        await onSaved()
      }}
    />
  )
}

type SyncFlags = {
  revision: string
  prune: boolean
  dryRun: boolean
  force: boolean
  applyOnly: boolean
  replace: boolean
  serverSideApply: boolean
  createNamespace: boolean
}
type SyncOptions = SyncFlags & { resources: { group: string; kind: string; name: string; namespace: string }[] }

function SyncModal({ resources, autoSync, appOptions, onSubmit, onClose }: {
  resources: AnyObj[]
  autoSync: boolean
  appOptions: string[]
  onSubmit: (opts: SyncOptions) => Promise<void>
  onClose: () => void
}) {
  const [opts, setOpts] = useState<SyncFlags>({
    revision: '',
    prune: false,
    dryRun: false,
    force: false,
    applyOnly: appOptions.includes('ApplyOutOfSyncOnly=true'),
    replace: appOptions.includes('Replace=true'),
    serverSideApply: appOptions.includes('ServerSideApply=true'),
    createNamespace: appOptions.includes('CreateNamespace=true'),
  })
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const syncable = resources.map((r, idx) => ({ r, idx })).filter(({ r }) => r.status === 'OutOfSync' || r.requiresPruning)

  const toggle = (idx: number) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(idx)) next.delete(idx); else next.add(idx)
    return next
  })

  const set = <K extends keyof SyncFlags>(k: K, v: SyncFlags[K]) => setOpts((prev) => ({ ...prev, [k]: v }))

  return (
    <Modal title="Synchronize" onClose={onClose}>
      <div className="overflow-auto space-y-3">
        {autoSync && <p className="text-[12px] text-amber-400">Auto-sync is enabled; a manual sync still runs once with the options below.</p>}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Revision (empty = target revision)</label>
          <input value={opts.revision} onChange={(e) => set('revision', e.target.value)} className="pods-glass-control rounded px-2 py-1 w-full mt-1 text-[13px]" spellCheck={false} placeholder="HEAD" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Check label="Prune" hint="Delete cluster resources that are no longer in Git. Without it, removed manifests are left running." checked={opts.prune} onChange={(v) => set('prune', v)} />
          <Check label="Dry run" hint="Preview only: validate and show what would be applied, without changing anything in the cluster." checked={opts.dryRun} onChange={(v) => set('dryRun', v)} />
          <Check label="Apply only (out-of-sync resources)" hint="Apply only resources that differ from Git and skip unchanged ones. Faster on large apps." checked={opts.applyOnly} onChange={(v) => set('applyOnly', v)} />
          <Check label="Force" hint="Use kubectl apply --force: delete and re-create a resource when it cannot be updated in place. Can cause downtime." checked={opts.force} onChange={(v) => set('force', v)} />
          <Check label="Replace" hint="Use kubectl replace/create instead of apply. Overwrites the whole live resource; helps with oversized annotations, but is destructive." checked={opts.replace} onChange={(v) => set('replace', v)} />
          <Check label="Server-side apply" hint="Let the Kubernetes API server merge changes (field ownership) instead of the client. Good for very large resources such as CRDs." checked={opts.serverSideApply} onChange={(v) => set('serverSideApply', v)} />
          <Check label="Create namespace" hint="Create the destination namespace if it does not exist yet." checked={opts.createNamespace} onChange={(v) => set('createNamespace', v)} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-label mb-1">
            Resources to sync ({picked.size === 0 ? 'all' : `${picked.size} selected`})
          </div>
          <div className="lucid-surface rounded max-h-[200px] overflow-auto p-2 space-y-1">
            {syncable.length === 0 && <p className="text-[12px] text-muted-foreground">No out-of-sync resources; all resources will be synced.</p>}
            {syncable.map(({ r, idx }) => (
              <Check key={idx} label={`${r.kind} ${r.namespace ? `${r.namespace}/` : ''}${r.name}`} checked={picked.has(idx)} onChange={() => toggle(idx)} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btnNeutral}>Cancel</button>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            const selectedRes = Array.from(picked).map((idx) => ({
              group: String(resources[idx].group ?? ''),
              kind: String(resources[idx].kind ?? ''),
              name: String(resources[idx].name ?? ''),
              namespace: String(resources[idx].namespace ?? ''),
            }))
            void onSubmit({ ...opts, resources: selectedRes })
          }}
        >
          {opts.dryRun ? 'Dry run' : 'Synchronize'}
        </button>
      </div>
    </Modal>
  )
}

function DeleteModal({ name, onConfirm, onClose }: { name: string; onConfirm: (mode: DeleteMode) => Promise<void>; onClose: () => void }) {
  const [mode, setMode] = useState<DeleteMode>('foreground')
  const [typed, setTyped] = useState('')
  const options: { id: DeleteMode; label: string; hint: string }[] = [
    { id: 'foreground', label: 'Foreground cascade', hint: 'Delete the app and its resources; wait for resources to be removed first.' },
    { id: 'background', label: 'Background cascade', hint: 'Delete the app and its resources in the background.' },
    { id: 'orphan', label: 'Non-cascading', hint: 'Delete only the Application; keep deployed resources.' },
  ]
  return (
    <Modal title={`Delete ${name}`} onClose={onClose}>
      <div className="space-y-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-start gap-2 cursor-pointer text-[13px]">
            <input type="radio" checked={mode === o.id} onChange={() => setMode(o.id)} className="mt-1" />
            <span><span className="font-semibold">{o.label}</span><br /><span className="text-muted-foreground text-[12px]">{o.hint}</span></span>
          </label>
        ))}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label">Type the application name to confirm</label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} className="pods-glass-control rounded px-2 py-1 w-full mt-1 text-[13px]" spellCheck={false} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btnNeutral}>Cancel</button>
        <button type="button" disabled={typed !== name} onClick={() => { void onConfirm(mode) }} className={btnDanger}>Delete</button>
      </div>
    </Modal>
  )
}
