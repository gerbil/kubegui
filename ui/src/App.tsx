import { useState, useMemo, useRef, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Provider } from 'react-redux'
import './assets/css/choices.css'
import {
  Boxes,
  Bug,
  Heart,
  CheckCircle2,
  Cloud,
  Search,
  Settings,
  Terminal,
  TriangleAlert,
  XCircle,
  Minus,
  Square,
  X,
  Radio,
  Plus,
  LayoutGrid,
  LayoutList,
  ArrowUpRight,
  Database,
  ShieldAlert,
  Wind,
} from 'lucide-react'
import { store } from './store/store'
import { ratioBadge, eventTypeBadge } from './lib/utils'
import { NodeActionDrawer, type NodeActionTarget } from './components/ui/NodeActionDrawer'
import { PodActionDrawer, type PodRow } from './components/ui/PodActionDrawer'
import { NamespaceActionDrawer, type NamespaceActionTarget } from './components/ui/NamespaceActionDrawer'
import { ResourceDrawer, type ResourceRef } from './components/ui/ResourceDrawer'
import { DeploymentActionDrawer, type DeploymentRow } from './components/ui/DeploymentActionDrawer'
import { UiTooltip } from './components/ui/UiTooltip'
import cronstrue from 'cronstrue'
import { ConfirmDialog } from './components/ui/Button'
import { Sidebar } from './components/ui/Sidebar'
import { InitPage } from './components/pages/InitPage'
import {
  AppConfigPickClusterIcon,
  DBGetClusterConfigs,
  DBGetActiveClusterConfig,
  DBMakeClusterConfigActive,
  DBDisconnectClusterConfig,
  DBRenameClusterConfig,
  DBDeleteClusterConfig,
  DBReorderClusterConfigs,
  InformerGetStatus,
  InformerStartForActiveCluster,
  InformerGetCRDDefinitions,
  ResourceList as ListBackendResources,
  ResourceAdd,
  ResourceDelete,
} from '../bindings/kubegui/services/backend'
import { CRDResourcePage as CRDResourcePageComponent } from './features/crds/CRDResourcePage'
import { wailsCall } from './lib/wailsQueue'
import type { Clusterconfig } from '../bindings/kubegui/internal/db/models'
import { Events, Window as WailsWindow } from '@wailsio/runtime'
import { useKubernetesContext } from './hooks/useKubernetesContext'
import { useSystemLogs } from './hooks/useSystemLogs'
import { useSystemEvents } from './hooks/useSystemEvents'
import { usePodStats, type PodStats } from './hooks/usePodStats'
import { useNodeWorkload } from './hooks/useNodeWorkload'
import { useNodeMetrics } from './hooks/useNodeMetrics'
import { usePersistentState } from './hooks/usePersistentState'
import { useClusterInfo } from './hooks/useClusterInfo'
import { DataTable } from './components/table/DataTable'
import { formatAge } from './lib/utils'
import { INFORMER_RESOURCE_NAMES, getInformerResourceLabel } from './lib/menu.config'
import { CRDDefinitionsPage } from './features/crds/CRDDefinitionsPage'
import { Select as MantineSelect } from '@mantine/core'
import { useNamespaceOptions } from './hooks/useNamespaceOptions'
import { useK8sResourceStore, type ResourceRow } from './store/useK8sResourceStore'
import { configureAceYamlEditor } from './lib/aceEditorConfig'
import { uiNotify } from './components/ui/UiNotify'
import { RESOURCE_YAML_TEMPLATES } from './lib/yamlTemplates'

/** Stable empty array – prevents Zustand getSnapshot from returning new ref every call */
const EMPTY_ROWS: ResourceRow[] = []
import { StatCardsSkeleton, NodeCardsSkeleton, NodeTableSkeleton, LogLinesSkeleton, EventLinesSkeleton } from './components/ui/Skeleton'
import defaultClusterIcon from './assets/icons/cluster.svg'

/** Portal-based fixed-position tooltip — escapes all overflow/scroll containers. */
function FixedTooltipInline({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <>
      <span ref={ref} style={{ display: 'inline' }}
        onMouseEnter={() => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); setPos({ x: r.left + r.width / 2, y: r.top - 6 }) }}
        onMouseLeave={() => setPos(null)}
      >{children}</span>
      {pos && createPortal(
        <div role="tooltip" style={{ position: 'fixed', left: pos.x, top: pos.y, transform: 'translate(-50%,-100%)', zIndex: 9999, pointerEvents: 'none', background: '#0f172a', color: '#f1f5f9', fontSize: 10, fontWeight: 500, padding: '6px 10px', borderRadius: 6, maxWidth: 360, whiteSpace: 'normal', wordBreak: 'break-word', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}

function humanAge(timestamp: string): string {
  const compact = formatAge(timestamp)
  if (compact === '—') return compact
  return `${compact} ago`
}

type DrawerTab = 'overview' | 'events' | 'shell' | 'edit'

let legacyChoicesAssetsPromise: Promise<void> | null = null
const loadedLegacyScripts = new Set<string>()

type NetworkActivityDetail = {
  phase: 'start' | 'end'
  id: string
  label: string
}

type ExternalLinkWindow = Window & { openURL?: (url: string) => void }

const NETWORK_ACTIVITY_EVENT = 'kubegui:network-activity'
const CLUSTER_CONNECTION_LOST_EVENT = 'kubegui:cluster-connection-lost'
const INIT_SESSION_KEY = 'kubegui:init-complete'
const INIT_CONTEXT_SESSION_KEY = 'kubegui:init-context'
const DEFAULT_FETCH_TIMEOUT_MS = 90000

function openExternalUrl(url: string) {
  try {
    (window as ExternalLinkWindow).openURL?.(url)
  } catch {
    window.open(url, '_blank')
  }
}

function readInitSessionState() {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(INIT_SESSION_KEY) === 'true'
  } catch {
    return false
  }
}

function fetchWithTimeout(
  originalFetch: typeof window.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const externalSignal = init?.signal
  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason)
  }

  const onExternalAbort = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

  const timer = window.setTimeout(() => {
    const timeoutSeconds = timeoutMs / 1000
    controller.abort(new Error(`Request timeout after ${timeoutSeconds} seconds`))
  }, timeoutMs)

  return originalFetch(input, { ...init, signal: controller.signal })
    .finally(() => {
      window.clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    })
}

function emitNetworkActivity(detail: NetworkActivityDetail) {
  window.dispatchEvent(new CustomEvent<NetworkActivityDetail>(NETWORK_ACTIVITY_EVENT, { detail }))
}

function formatPendingLabel(label: string) {
  if (label.length <= 68) return label
  return `${label.slice(0, 65)}...`
}

function pathFromUrlLike(raw: string) {
  try {
    const u = new URL(raw, window.location.origin)
    return `${u.pathname}${u.search}`
  } catch {
    return raw
  }
}

function friendlyLoadingLabel(pathWithQuery: string, method: string) {
  const lower = pathWithQuery.toLowerCase()

  if (lower.includes('/wails/runtime')) return ''
  if (lower.includes('/api/v1/resources/pods') || lower.includes('/resource/details/pods') || lower.includes('/resource/logs/pods') || lower.includes('/resource/pod/metrics')) {
    return method === 'GET' ? 'Loading pods data' : 'Updating pods data'
  }
  if (lower.includes('/api/v1/resources/nodes') || lower.includes('/api/v1/node/') || lower.includes('/resource/details/nodes') || lower.includes('/resource/nodes/')) {
    return method === 'GET' ? 'Loading nodes data' : 'Updating nodes data'
  }
  if (lower.includes('/api/v1/resources/deployments') || lower.includes('/resource/details/deployments') || lower.includes('/resource/logs/deployments') || lower.includes('/resource/scale/')) {
    return method === 'GET' ? 'Loading deployments data' : 'Updating deployments data'
  }
  if (lower.includes('/api/v1/resources/namespaces') || lower.includes('/resource/details/namespaces') || lower.includes('/api/v1/namespace-events/') || lower.includes('/api/v1/stream/namespace-events/')) {
    return method === 'GET' ? 'Loading namespaces data' : 'Updating namespaces data'
  }
  if (lower.includes('/api/v1/cluster-logs') || lower.includes('/api/v1/stream/cluster-logs')) {
    return 'Loading cluster logs'
  }
  if (lower.includes('/api/v1/resources/events') || lower.includes('/resource/events/')) {
    return 'Loading events data'
  }
  if (lower.includes('/resource/edit/') || lower.includes('/resource/delete/') || lower.includes('/resource/restart/')) {
    return 'Applying cluster changes'
  }

  return method === 'GET' ? 'Loading cluster data' : 'Applying cluster changes'
}

function fetchLabel(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()
  let rawUrl = ''
  if (typeof input === 'string') rawUrl = input
  else if (input instanceof URL) rawUrl = input.toString()
  else rawUrl = input.url
  const path = pathFromUrlLike(rawUrl)
  const friendly = friendlyLoadingLabel(path, method)
  if (!friendly) return ''
  return formatPendingLabel(friendly)
}

function shouldTrackPendingFetch(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()
  let rawUrl = ''
  if (typeof input === 'string') rawUrl = input
  else if (input instanceof URL) rawUrl = input.toString()
  else rawUrl = input.url

  try {
    const u = new URL(rawUrl, window.location.origin)
    const pathnameLower = u.pathname.toLowerCase()
    // Ignore internal Wails bridge transport noise from footer progress.
    if (pathnameLower.includes('/wails/runtime')) return false

    const ignoredPrefixes = [
      '/assets/',
      '/@vite/',
      '/@react-refresh',
      '/src/',
      '/node_modules/',
      '/@id/',
      '/__vite_ping',
    ]
    if (ignoredPrefixes.some((prefix) => u.pathname.startsWith(prefix))) return false
  } catch {
    // If URL parsing fails, keep tracking by default.
  }

  // Keep non-GET request tracking for meaningful backend actions (except ignored internal paths above).
  if (method !== 'GET') return true

  return true
}

function loadLegacyScript(src: string) {
  const SCRIPT_TIMEOUT_MS = 12000
  const scriptUrlCandidates = (raw: string): string[] => {
    // Load legacy assets from the frontend static bundle only.
    return [raw]
  }

  return new Promise<void>((resolve, reject) => {
    const activityId = `script:${src}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
    const label = formatPendingLabel(`SCRIPT ${pathFromUrlLike(src)}`)
    emitNetworkActivity({ phase: 'start', id: activityId, label })
    let finished = false
    const finish = (err?: Error) => {
      if (finished) return
      finished = true
      emitNetworkActivity({ phase: 'end', id: activityId, label })
      if (err) reject(err)
      else resolve()
    }

    const injected = document.querySelector(`script[data-legacy-src="${src}"]`) as HTMLScriptElement | null
    if (injected || loadedLegacyScripts.has(src)) {
      loadedLegacyScripts.add(src)
      finish()
      return
    }

    const injectViaFetch = async (candidate: string) => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), SCRIPT_TIMEOUT_MS)
      try {
        const res = await fetch(candidate, { cache: 'no-store', signal: controller.signal })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const code = await res.text()
        if (!code.trim()) {
          throw new Error('empty response')
        }

        const injected = document.createElement('script')
        injected.dataset.loaded = 'true'
        injected.dataset.legacySrc = src
        injected.text = `${code}\n//# sourceURL=${candidate}`
        document.head.appendChild(injected)
        loadedLegacyScripts.add(src)
        finish()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown error'
        if (msg.toLowerCase().includes('aborted')) {
          throw new Error(`Timed out loading ${candidate}`)
        }
        throw new Error(`Failed to load ${candidate}: ${msg}`)
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void (async () => {
      let lastErr: Error | null = null
      for (const candidate of scriptUrlCandidates(src)) {
        try {
          await injectViaFetch(candidate)
          return
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(`Failed to load ${candidate}`)
        }
      }
      finish(lastErr ?? new Error(`Failed to load ${src}`))
    })()
  })
}

function ensureLegacyChoicesAssets() {
  if (legacyChoicesAssetsPromise) return legacyChoicesAssetsPromise

  legacyChoicesAssetsPromise = (async () => {
    // CSS is bundled via imports; only legacy JS global fallback is loaded here.
    await loadLegacyScript('/assets/js/choices.js')
  })()

  legacyChoicesAssetsPromise.catch(() => {
    legacyChoicesAssetsPromise = null
  })

  return legacyChoicesAssetsPromise
}

function normalizePath(rawPath: string) {
  const stripped = (rawPath || '/').split('?')[0].split('#')[0] || '/'
  let path = stripped.startsWith('/') ? stripped : `/${stripped}`
  path = path.replace(/\/+/g, '/')

  if (path === '/index.html') path = '/'
  if (path.startsWith('/index.html/')) {
    path = path.slice('/index.html'.length) || '/'
  }

  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }

  return path || '/'
}

function parseInformerResourcePath(path: string): string | null {
  const match = /^\/resources\/([^/]+)$/.exec(path)
  if (!match?.[1]) return null
  const decoded = decodeURIComponent(match[1]).toLowerCase()
  return (INFORMER_RESOURCE_NAMES as readonly string[]).includes(decoded) ? decoded : null
}

function parseCRDResourcePath(path: string): { group: string; plural: string } | null {
  const match = /^\/crds\/([^/]+)\/([^/]+)$/.exec(path)
  if (!match?.[1] || !match?.[2]) return null
  return { group: decodeURIComponent(match[1]), plural: decodeURIComponent(match[2]) }
}

function CRDResourceView({ group, plural, onNavigateBack }: { group: string; plural: string; onNavigateBack?: () => void }) {
  type CRDDef = Parameters<typeof CRDResourcePageComponent>[0]['definition']
  const [def, setDef] = useState<CRDDef | null>(null)
  const [canGenerateTemplate, setCanGenerateTemplate] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    InformerGetCRDDefinitions()
      .then((defs) => {
        if (cancelled) return
        const found = (defs ?? []).find(
          (d) => d.plural?.toLowerCase() === plural.toLowerCase() && d.group?.toLowerCase() === group.toLowerCase()
        )
        if (found) {
          setDef(found as CRDDef)
          setCanGenerateTemplate(true)
        } else {
          // Not a real CRD — build a synthetic definition so we can still call
          // ResourceList for built-in resources from non-standard API groups
          // (e.g. admissionregistration.k8s.io, coordination.k8s.io, etc.)
          const kindGuess = plural
            .replace(/s$/, '')
            .replace(/(?:^|-)(\w)/g, (_: string, c: string) => c.toUpperCase())
          setDef({
            name: `${plural}.${group}`,
            group,
            kind: kindGuess,
            plural,
            scope: 'Cluster',
            versions: ['v1'],
            columns: [],
          } as CRDDef)
          setCanGenerateTemplate(false)
        }
      })
      .catch((e: unknown) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load CRDs') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [group, plural])
  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground/50 uppercase tracking-widest">Loading…</span>
        </div>
      </div>
    )
  }
  if (loadError || !def) {
    return (
      <div className="flex-1 px-12 py-8">
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {loadError ?? 'CRD definition not found'}
        </div>
      </div>
    )
  }
  return <CRDResourcePageComponent definition={def} onNavigateBack={onNavigateBack} canGenerateTemplate={canGenerateTemplate} />
}

type AllocationNavigationTarget = {
  resource: 'pods' | 'deployments' | 'daemonsets'
  namespace: string
  name: string
  statusFilter?: 'warnings' | 'failed'
}

function allocationTargetFromPod(alloc: import('./hooks/useNodeWorkload').PodAllocation): AllocationNavigationTarget {
  const category = alloc.category
  if (category === 'daemonset') {
    return { resource: 'daemonsets', namespace: alloc.namespace, name: alloc.name }
  }
  return { resource: 'pods', namespace: alloc.namespace, name: alloc.name }
}

function readNavigationFilterFromUrl() {
  if (typeof window === 'undefined') return { namespace: '', query: '', filter: '' }
  const params = new URLSearchParams(window.location.search)
  return {
    namespace: (params.get('namespace') || '').trim(),
    query: (params.get('q') || '').trim(),
    filter: (params.get('filter') || '').trim(),
  }
}

async function listResourcesViaBinding(resource: string, namespace: string) {
  const response = await ListBackendResources(resource, namespace)
  if (Array.isArray(response)) return response
  if (response && typeof response === 'object' && Array.isArray((response as Record<string, unknown>).items)) {
    return (response as Record<string, unknown>).items as unknown[]
  }
  return []
}

async function listNamespacesViaBinding() {
  return await listResourcesViaBinding('namespaces', 'all')
}


type LegacyAce = {
  edit: (el: HTMLElement | string) => {
    setValue: (v: string, cursor?: number) => void
    getValue: () => string
    setOptions: (opts: Record<string, unknown>) => void
    setTheme: (theme: string) => void
    getSession: () => {
      setMode: (m: string) => void
      on: (e: string, cb: () => void) => void
      getAnnotations?: () => { type?: string }[]
      getUndoManager: () => { markClean: () => void }
    }
    destroy: () => void
    resize?: (force?: boolean) => void
    renderer?: { updateFull: (force?: boolean) => void; scrollToRow: (row: number) => void }
    scrollToRow?: (row: number) => void
  }
}
type JsYamlWindow = Window & typeof globalThis & { ace?: LegacyAce; jsyaml?: { load: (v: string) => unknown } }

function App() {
  // Emit ui-ready after the first real browser paint so window.Show() is called
  // only once content is visible — prevents the gray/blank startup flash.
  // Double rAF: first frame schedules paint, second frame fires after it completes.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void Events.Emit('ui-ready', null)
      })
    })
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <Provider store={store}>
      <RootView />
    </Provider>
  )
}

type ClusterRailItem = {
  id: string
  label: string
  context: string
  fileName: string
  userName: string
  imagePath: string
  isActive: boolean
}

type ClusterRailMenuState = {
  item: ClusterRailItem
  x: number
  y: number
}

type ClusterRailRenameState = {
  item: ClusterRailItem
  value: string
  busy: boolean
}

function resolveClusterIcon(imagePath: string, cacheBust?: number): string {
  const withCacheBust = (url: string) => {
    if (!cacheBust) return url
    return `${url}${url.includes('?') ? '&' : '?'}v=${cacheBust}`
  }
  const localProxyUrl = (rawPath: string) => {
    const parts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean)
    const fileName = parts[parts.length - 1] || ''
    if (!fileName) return defaultClusterIcon
    return withCacheBust(`/local-images/${encodeURIComponent(fileName)}`)
  }
  const raw = String(imagePath || '').trim()
  if (!raw) return defaultClusterIcon
  if (raw.includes('cluster.svg')) return defaultClusterIcon
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('file://')) {
    if (raw.startsWith('file://')) {
      return localProxyUrl(raw.replace(/^file:\/\//, ''))
    }
    return raw.startsWith('data:') || raw.startsWith('blob:') ? raw : withCacheBust(raw)
  }
  // Windows absolute path (e.g. C:\icons\cluster.png)
  if (/^[a-zA-Z]:\\/.test(raw)) {
    return localProxyUrl(raw)
  }
  // Unix absolute path (e.g. /home/user/icon.png)
  if (raw.startsWith('/')) {
    return localProxyUrl(raw)
  }
  return defaultClusterIcon
}

function resolveClusterUserName(cfg: Record<string, unknown>): string {
  const direct = [cfg.User, cfg.user, cfg.ContextUser, cfg.contextUser, cfg.AuthInfo, cfg.authInfo]
  for (const candidate of direct) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }

  // Fallback: common kube context format is "user@cluster".
  const contextLike = String(cfg.ContextName ?? cfg.contextName ?? cfg.Context ?? cfg.context ?? '').trim()
  if (contextLike.includes('@')) {
    const user = contextLike.split('@')[0]?.trim()
    if (user) return user
  }

  return ''
}

function AppChrome({
  pageTitle,
  context,
  onSettings,
  showContextBadge = true,
  showAppIcon = false,
}: {
  pageTitle: string
  context: string
  onSettings: () => void
  showContextBadge?: boolean
  showAppIcon?: boolean
}) {
  const [isMaximised, setIsMaximised] = useState(false)

  useEffect(() => {
    let mounted = true
    void WailsWindow.IsMaximised().then((v) => {
      if (mounted) setIsMaximised(v)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  const syncMaxState = useCallback(async () => {
    try {
      setIsMaximised(await WailsWindow.IsMaximised())
    } catch {
      // ignore runtime errors
    }
  }, [])

  const minimise = useCallback(async () => {
    try {
      await WailsWindow.Minimise()
      await syncMaxState()
    } catch {
      // ignore runtime errors
    }
  }, [syncMaxState])

  const toggleMaximise = useCallback(async () => {
    try {
      await WailsWindow.ToggleMaximise()
      await syncMaxState()
    } catch {
      // ignore runtime errors
    }
  }, [syncMaxState])

  const closeWindow = useCallback(async () => {
    try {
      await WailsWindow.Close()
    } catch {
      // ignore runtime errors
    }
  }, [])

  return (
    <header className="lucid-footer h-12 shrink-0 flex items-center justify-between px-6 border-b border-border/40 select-none" style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
           {showAppIcon && (
             <img
               src="/build/appicon.png"
               alt="KubeGUI"
               className="h-8 w-8 object-contain rounded-md"
               onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
             />
           )}
          <h2 className="text-sm font-semibold font-headline truncate">{pageTitle}</h2>
          {showContextBadge && context.trim() && (
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20 font-bold uppercase tracking-tight truncate">{context}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <UiTooltip content="Support KubeGUI" side="bottom">
          <button
            className="lucid-control h-8 w-8 rounded-md text-muted-foreground hover:text-foreground flex items-center justify-center"
            onClick={() => openExternalUrl('https://github.com/sponsors/gerbil')}
          >
            <Heart size={16} />
          </button>
        </UiTooltip>
        <UiTooltip content="Submit a bug" side="bottom">
          <button
            className="lucid-control h-8 w-8 rounded-md text-muted-foreground hover:text-foreground flex items-center justify-center"
            onClick={() => openExternalUrl('https://github.com/gerbil/kubegui/issues')}
          >
            <Bug size={16} />
          </button>
        </UiTooltip>
        <UiTooltip content="Settings" side="bottom">
          <button className="lucid-control h-8 w-8 rounded-md text-muted-foreground hover:text-foreground flex items-center justify-center" onClick={onSettings}>
            <Settings size={16} />
          </button>
        </UiTooltip>
        <div className="mx-2 h-5 w-px bg-border/60" />
        <button type="button" className="h-8 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 flex items-center justify-center" onClick={() => { void minimise() }} aria-label="Minimise window" title="Minimise window">
          <Minus size={16} />
        </button>
        <button type="button" className="h-8 w-9 rounded-md text-muted-foreground hover:text-red-300 hover:bg-red-500/10 flex items-center justify-center" onClick={() => { void toggleMaximise() }} aria-label={isMaximised ? 'Restore window' : 'Maximise window'} title={isMaximised ? 'Restore window' : 'Maximise window'}>
          <Square size={15} />
        </button>
        <button type="button" className="h-8 w-9 rounded-md text-muted-foreground hover:text-red-300 hover:bg-red-500/10 flex items-center justify-center" onClick={() => { void closeWindow() }} aria-label="Close window" title="Close window">
          <X size={16} />
        </button>
      </div>
    </header>
  )
}

function ClusterRail({ currentContext, onDisconnected }: { currentContext: string; onDisconnected?: () => void }) {
  const [clusterRailItems, setClusterRailItems] = useState<ClusterRailItem[]>([])
  const [iconRefreshVersions, setIconRefreshVersions] = useState<Record<string, number>>({})
  const [menuState, setMenuState] = useState<ClusterRailMenuState | null>(null)
  const [renameState, setRenameState] = useState<ClusterRailRenameState | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [suppressClickConnect, setSuppressClickConnect] = useState(false)
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({})

  // Reference configErrors so static analysis recognizes the variable is used
  useEffect(() => {
    void Object.keys(configErrors).length
  }, [configErrors])

  const openAddClusterDialog = useCallback(() => {
    // Reuse the same event consumed by init page/backend file-dialog flow.
    void Events.Emit('addClusterConfig', 'addcluster')
  }, [])

  const loadClusterRailItems = useCallback(async () => {
    if (!(typeof window !== 'undefined' && ('__wails' in window || '_wails' in window))) {
      setClusterRailItems([])
      return
    }

    try {
      const configs = await DBGetClusterConfigs()
      const items: ClusterRailItem[] = (configs ?? []).map((cfg: Clusterconfig) => {
        const context = String(cfg.Context ?? '')
        const label = String(cfg.ContextName ?? (context || 'cluster'))
        const userName = resolveClusterUserName(cfg as unknown as Record<string, unknown>)
        const fileName = String(cfg.FileName ?? '')
        const imagePath = String(cfg.ImagePath ?? '')
        return {
          id: `${fileName}|${context}`,
          label,
          context,
          fileName,
          userName,
          imagePath,
          isActive: Number(cfg.Active ?? 0) === 1,
        }
      })
      setClusterRailItems(items)
    } catch {
      setClusterRailItems([])
    }
  }, [])

  useEffect(() => {
    void loadClusterRailItems()
  }, [loadClusterRailItems])

  useEffect(() => {
    return Events.On('clusterConfigsChanged', () => {
      void loadClusterRailItems()
    })
  }, [loadClusterRailItems])

  useEffect(() => {
    if (!menuState) return
    const onClose = () => setMenuState(null)
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuState(null)
    }
    window.addEventListener('click', onClose)
    window.addEventListener('contextmenu', onClose)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('click', onClose)
      window.removeEventListener('contextmenu', onClose)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [menuState])

  // Listen for informer progress errors and mark active config as errored.
  // Also update informerStatus immediately on started/synced/error so the
  // dashboard gate (informerReady) flips without waiting for the next poll.
  useEffect(() => {
    const off = Events.On('informerProgress', async (ev: unknown) => {
      const payload = (ev as { data?: { stage?: string; message?: string } })?.data
      if (!payload?.stage) return


      try {
        if (payload.stage === 'error') {
          const active = await DBGetActiveClusterConfig()
          const key = `${String(active.FileName || '')}|${String(active.Context || '')}`
          setConfigErrors((prev) => ({ ...prev, [key]: payload.message ?? 'informer error' }))
        }
        if (payload.stage === 'synced') {
          const active = await DBGetActiveClusterConfig()
          const key = `${String(active.FileName || '')}|${String(active.Context || '')}`
          setConfigErrors((prev) => {
            const next = { ...prev }
            delete next[key]
            return next
          })
        }
      } catch {
        // ignore
      }
    })
    return () => { off?.() }
  }, [])

  const onConnect = useCallback(async (item: ClusterRailItem) => {
    try {
      await DBMakeClusterConfigActive(item.context, item.fileName)
      await loadClusterRailItems()
      uiNotify.success(`Connected: ${item.label}`)
    } catch (err) {
      uiNotify.error(`Connect failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }, [loadClusterRailItems])

  const onDisconnect = useCallback(async () => {
    try {
      await DBDisconnectClusterConfig()
      await loadClusterRailItems()
      uiNotify.success('Disconnected active cluster')
      onDisconnected?.()
    } catch (err) {
      uiNotify.error(`Disconnect failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }, [loadClusterRailItems, onDisconnected])

  const openRenameDialog = useCallback((item: ClusterRailItem) => {
    setRenameState({ item, value: item.label, busy: false })
  }, [])

  const closeRenameDialog = useCallback(() => {
    setRenameState(null)
  }, [])

  const submitRename = useCallback(async () => {
    if (!renameState || renameState.busy) return
    const nextName = renameState.value.trim()
    if (!nextName || nextName === renameState.item.label) {
      setRenameState(null)
      return
    }
    setRenameState((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      await DBRenameClusterConfig(renameState.item.label, nextName, renameState.item.context, renameState.item.fileName)
      // Optimistic local update so tooltip reflects the new name immediately.
      setClusterRailItems((prev) => prev.map((it) => (it.id === renameState.item.id ? { ...it, label: nextName } : it)))
      await loadClusterRailItems()
      uiNotify.success(`Renamed to: ${nextName}`)
      setRenameState(null)
    } catch (err) {
      uiNotify.error(`Rename failed: ${err instanceof Error ? err.message : 'unknown error'}`)
      setRenameState((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [loadClusterRailItems, renameState])

  const onChangeIcon = useCallback(async (item: ClusterRailItem) => {
    try {
      const path = await AppConfigPickClusterIcon(item.context, item.fileName)
      const refreshVersion = Date.now()
      setIconRefreshVersions((prev) => ({ ...prev, [item.id]: refreshVersion }))
      if (path && path.trim()) {
        // Optimistic local update so the rail icon swaps immediately.
        setClusterRailItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, imagePath: path } : it)))
      }
      await loadClusterRailItems()
      if (path) {
        uiNotify.success(`Icon updated for ${item.label}`)
      }
    } catch (err) {
      uiNotify.error(`Change icon failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }, [loadClusterRailItems])

  const onDelete = useCallback(async (item: ClusterRailItem) => {
    try {
      await DBDeleteClusterConfig(item.context, item.fileName)
      await loadClusterRailItems()
      uiNotify.success(`Deleted: ${item.label}`)
    } catch (err) {
      uiNotify.error(`Delete failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }, [loadClusterRailItems])

  const menuAction = useCallback(async (action: 'connect' | 'disconnect' | 'rename' | 'icon' | 'delete') => {
    const state = menuState
    if (!state) return
    setMenuState(null)
    if (action === 'disconnect') {
      await onDisconnect()
      return
    }
    if (action === 'connect') {
      await onConnect(state.item)
      return
    }
    if (action === 'rename') {
      openRenameDialog(state.item)
      return
    }
    if (action === 'icon') {
      await onChangeIcon(state.item)
      return
    }
    await onDelete(state.item)
  }, [menuState, onChangeIcon, onConnect, onDelete, onDisconnect, openRenameDialog])

  const reorderItems = useCallback((items: ClusterRailItem[], sourceId: string, targetId: string) => {
    if (sourceId === targetId) return items
    const sourceIndex = items.findIndex((item) => item.id === sourceId)
    const targetIndex = items.findIndex((item) => item.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return items
    const next = [...items]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    return next
  }, [])

  const persistRailOrder = useCallback(async (items: ClusterRailItem[]) => {
    const payload = items.map((item) => `${item.fileName}|${item.context}`)
    try {
      await DBReorderClusterConfigs(payload)
      await loadClusterRailItems()
    } catch (err) {
      uiNotify.error(`Reorder failed: ${err instanceof Error ? err.message : 'unknown error'}`)
      await loadClusterRailItems()
    }
  }, [loadClusterRailItems])

  useEffect(() => {
    if (!renameState) return
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !renameState.busy) {
        setRenameState(null)
      }
      if (e.key === 'Enter') {
        void submitRename()
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [renameState, submitRename])

  return (
    <>
      <aside className="w-16 shrink-0 bg-surface-container-low/80 backdrop-blur-xl rounded-xl z-40 flex flex-col items-center gap-3 py-4 border border-border/20">
        <div className="mb-2 text-primary/80">
          <Cloud size={20} />
        </div>
        {clusterRailItems.map((item) => {
          const active = item.isActive || item.context.trim() === currentContext.trim()
          const tooltipContext = item.label || item.context
          const tooltipUser = item.userName || 'unknown'
          return (
            <UiTooltip
              key={item.id}
              side="right"
              disabled={Boolean(draggingId)}
              offset={4}
              content={(
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold">{tooltipContext}</span>
                  <span className="text-[10px] text-muted-foreground">ctx: {item.context || 'unknown'}</span>
                  <span className="text-[10px] text-muted-foreground">user: {tooltipUser}</span>
                </div>
              )}
            >
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  setDraggingId(item.id)
                  setDragOverId(item.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', item.id)
                  setSuppressClickConnect(true)
                }}
                onDragOver={(e) => {
                  if (!draggingId) return
                  e.preventDefault()
                  if (dragOverId !== item.id) {
                    setDragOverId(item.id)
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const sourceId = draggingId || e.dataTransfer.getData('text/plain')
                  const targetId = item.id
                  if (!sourceId || !targetId || sourceId === targetId) return
                  const next = reorderItems(clusterRailItems, sourceId, targetId)
                  setClusterRailItems(next)
                  void persistRailOrder(next)
                }}
                onDragEnd={() => {
                  setDraggingId(null)
                  setDragOverId(null)
                  window.setTimeout(() => setSuppressClickConnect(false), 0)
                }}
                onClick={() => {
                  if (suppressClickConnect || currentContext.trim().length > 0) return
                  void onConnect(item)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenuState({ item, x: e.clientX, y: e.clientY })
                }}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all relative border ${
                  draggingId === item.id
                    ? 'opacity-60 ring-1 ring-primary/40'
                    : dragOverId === item.id && draggingId
                      ? 'ring-1 ring-primary/50'
                      : ''
                } ${
                  active
                    ? 'border-blue-400/50 bg-blue-400/10 hover:bg-blue-400/20'
                    : 'bg-transparent border-transparent hover:bg-accent/60 hover:border-border/60'
                }`}
              >
                <div className={`rounded-lg p-1.5 transition-colors`}>
                  <img
                    src={resolveClusterIcon(item.imagePath, iconRefreshVersions[item.id])}
                    alt={item.label}
                    draggable={false}
                    className="w-6 h-6 object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultClusterIcon }}
                  />
                </div>
                  {configErrors[item.id] && (
                    <div title={configErrors[item.id]} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-400 ring-1 ring-red-200" />
                  )}
              </button>
            </UiTooltip>
          )
        })}
        <div className="mt-auto pt-2 w-full flex justify-center">
          <UiTooltip content="Add cluster config">
            <button
              type="button"
              onClick={openAddClusterDialog}
              className="w-12 h-12 rounded-xl flex items-center justify-center text-muted-foreground border border-dashed border-border/70 transition-all hover:bg-primary/10 hover:text-primary hover:border-primary/40"
            >
              <Plus size={20} />
            </button>
          </UiTooltip>
        </div>
      </aside>
      {menuState && createPortal(
        <div
          className="fixed w-max max-w-[320px] rounded-lg border border-border bg-card shadow-2xl overflow-hidden"
          style={{ left: menuState.x, top: menuState.y, zIndex: 2147483647 }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border/70">
            <button type="button" className="block whitespace-nowrap text-left px-3 py-1 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void menuAction('connect') }}>Connect</button>
            <button type="button" className="block whitespace-nowrap text-left px-3 py-1 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void menuAction('disconnect') }}>Disconnect</button>
          </div>
          <div className="border-b border-border/70">
            <button type="button" className="block whitespace-nowrap text-left px-3 py-1 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void menuAction('rename') }}>Rename</button>
            <button type="button" className="block whitespace-nowrap text-left px-3 py-1 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void menuAction('icon') }}>Change Icon</button>
          </div>
          <div>
            <button type="button" className="block whitespace-nowrap text-left px-3 py-1 text-sm text-red-400 hover:bg-red-500/10 min-w-[170px]" onClick={() => { void menuAction('delete') }}>Delete</button>
          </div>
        </div>,
        document.body,
      )}
      {renameState && createPortal(
        <>
          <div className="fixed inset-0 bg-black/60 z-[1200]" onClick={renameState.busy ? undefined : closeRenameDialog} />
          <div
            className="fixed z-[1201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 border-b border-border/60 bg-accent/20">
              <p className="text-sm font-semibold text-foreground">Rename Cluster</p>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">Update display name for this cluster entry.</p>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</p>
              <p className="text-sm font-mono text-foreground/90">{renameState.item.label}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">New Name</p>
              <input
                autoFocus
                value={renameState.value}
                onChange={(e) => setRenameState((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                className="w-full lucid-control rounded px-2 py-1.5 text-sm focus:outline-none"
                disabled={renameState.busy}
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button
                type="button"
                onClick={closeRenameDialog}
                disabled={renameState.busy}
                className="px-4 py-1.5 rounded text-sm font-semibold border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void submitRename() }}
                disabled={renameState.busy}
                className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90"
              >
                {renameState.busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function RootView() {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname || '/'))
  const [isInitialized, setIsInitialized] = useState(() => readInitSessionState())
  const [userRole] = useState<'admin' | 'user' | 'viewer'>('admin')
  const [informerStatus, setInformerStatus] = useState<{ started: boolean; synced: boolean; lastError?: string } | null>(null)
  const informerReady = informerStatus?.started === true && informerStatus?.synced === true
  const shouldShowInitPage = !isInitialized || currentPath === '/init' || !informerReady
  const { context } = useKubernetesContext()
  const { info: clusterInfo, appStats } = useClusterInfo(!shouldShowInitPage)
  const { stats: podStats, error: podStatsError, isLoading: podStatsLoading } = usePodStats(!shouldShowInitPage)
  const [pendingActionLabel] = useState<string | null>(null)
  const [pendingRequests, setPendingRequests] = useState(0)
  const [pendingRequestLabels, setPendingRequestLabels] = useState<string[]>([])

  useEffect(() => {
    // Avoid concurrent legacy script prewarm races (xterm globals can redeclare).
    void ensureLegacyChoicesAssets()

    const originalFetch = window.fetch.bind(window)
    const pendingById = new Map<string, string>()
    let seq = 0

    const syncPending = () => {
      const labels = Array.from(pendingById.values())
      setPendingRequests(labels.length)
      setPendingRequestLabels(labels.slice(0, 8))
    }

    const onNetworkActivity = (event: Event) => {
      const e = event as CustomEvent<NetworkActivityDetail>
      const detail = e.detail
      if (!detail?.id) return
      if (detail.phase === 'start') {
        pendingById.set(detail.id, detail.label)
      } else {
        pendingById.delete(detail.id)
      }
      syncPending()
    }

    window.addEventListener(NETWORK_ACTIVITY_EVENT, onNetworkActivity as EventListener)

    window.fetch = (async (...args: Parameters<typeof fetch>) => {
      const fetchTask = () => fetchWithTimeout(originalFetch, args[0], args[1], DEFAULT_FETCH_TIMEOUT_MS)
      if (!shouldTrackPendingFetch(args[0], args[1])) {
        return await fetchTask()
      }

      const id = `fetch:${++seq}`
      const label = fetchLabel(args[0], args[1])
      pendingById.set(id, label)
      syncPending()
      try {
        return await fetchTask()
      } finally {
        pendingById.delete(id)
        syncPending()
      }
    }) as typeof fetch

    return () => {
      window.removeEventListener(NETWORK_ACTIVITY_EVENT, onNetworkActivity as EventListener)
      window.fetch = originalFetch
      pendingById.clear()
    }
  }, [])
  useEffect(() => {
    const onPopState = () => setCurrentPath(normalizePath(window.location.pathname || '/'))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    try {
      window.sessionStorage.setItem(INIT_SESSION_KEY, JSON.stringify(isInitialized))
    } catch {
      // ignore storage errors
    }
  }, [isInitialized])

  useEffect(() => {
    if (!isInitialized) {
      setInformerStatus(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const pending: { cancel: () => void } | null = null

    const poll = async () => {
      if (cancelled) return
      try {
        const status = await wailsCall(() => InformerGetStatus())
        if (cancelled) return
        const statusObj = status as typeof status & { lastError?: unknown; message?: unknown }
        setInformerStatus({
          started: status.started ?? false,
          synced: status.synced ?? false,
          lastError: String(statusObj.lastError ?? statusObj.message ?? ''),
        })
      } catch (error) {
        if (cancelled) return
        console.debug('InformerGetStatus poll failed (transient):', error)
      }
      // Recursive setTimeout — next poll only fires after current one completes,
      // preventing concurrent call pile-up that causes 90s timeouts.
      if (!cancelled) {
        timer = setTimeout(poll, 3000)
      }
    }

    void InformerStartForActiveCluster().catch((error) => {
      console.warn('InformerStartForActiveCluster failed', error)
    })

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      ;(pending as { cancel: () => void } | null)?.cancel()
    }
  }, [isInitialized])

  const navigateTo = (href: string) => {
    const nextUrl = new URL(href, window.location.origin)
    const nextPath = normalizePath(nextUrl.pathname)
    const nextSearch = nextUrl.search
    const currentNormalizedPath = normalizePath(window.location.pathname || '/')
    const currentSearch = window.location.search || ''
    if (nextPath === currentNormalizedPath && nextSearch === currentSearch) return
    window.history.pushState({}, '', `${nextPath}${nextSearch}`)
    setCurrentPath(nextPath)
  }

  const navigateToResourceTarget = useCallback((target: AllocationNavigationTarget) => {
    const path = target.resource === 'pods' ? '/pods' : `/resources/${target.resource}`
    const params = new URLSearchParams()
    if (target.namespace && target.namespace !== 'all') params.set('namespace', target.namespace)
    if (target.name) params.set('q', target.name)
    if (target.statusFilter) params.set('filter', target.statusFilter)
    const query = params.toString()
    navigateTo(query ? `${path}?${query}` : path)
  }, [navigateTo])

  useEffect(() => {
    const onClusterConnectionLost = () => {
      setIsInitialized(false)
      try {
        window.sessionStorage.removeItem(INIT_CONTEXT_SESSION_KEY)
      } catch {
        // ignore storage errors
      }
      uiNotify.error('Cluster connection lost. Please retry.')
      const initPath = normalizePath('/init')
      if (normalizePath(window.location.pathname || '/') !== initPath) {
        window.history.pushState({}, '', initPath)
      }
      setCurrentPath(initPath)
    }

    window.addEventListener(CLUSTER_CONNECTION_LOST_EVENT, onClusterConnectionLost)
    return () => {
      window.removeEventListener(CLUSTER_CONNECTION_LOST_EVENT, onClusterConnectionLost)
    }
  }, [])

  const handleContextSelected = (contextName: string) => {
    setIsInitialized(true)
    try {
      window.sessionStorage.setItem(INIT_CONTEXT_SESSION_KEY, contextName)
    } catch {
      // ignore storage errors
    }
    navigateTo('/')
  }

  if (shouldShowInitPage) {
    return (
      <div className="lucid-shell flex h-screen w-full overflow-hidden text-foreground">
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <AppChrome pageTitle="KubeGUI" context={context} onSettings={() => navigateTo('/settings')} showContextBadge={false} showAppIcon />
          <InitPage onContextSelected={handleContextSelected} hideHeader />
        </main>
      </div>
    )
  }

  const formatStat = (value: unknown, decimals: number) => {
    const num = typeof value === 'number' ? value : Number.parseFloat(String(value))
    return Number.isFinite(num) ? num.toFixed(decimals) : '—'
  }

  const informerResourceFromPath = parseInformerResourcePath(currentPath)
  const crdResourceFromPath = parseCRDResourcePath(currentPath)

  let pageTitle = 'Dashboard'
  if (currentPath === '/namespaces' || currentPath === '/cluster/namespaces') pageTitle = 'Cluster / Namespaces'
  if (currentPath === '/pods') pageTitle = 'Cluster / Pods'
  if (currentPath === '/deployments') pageTitle = 'Cluster / Deployments'
  if (informerResourceFromPath) pageTitle = `Cluster / ${getInformerResourceLabel(informerResourceFromPath)}`
  if (currentPath === '/settings') pageTitle = 'Settings'

  let pageContent: ReactNode = (
    <DashboardPage
      stats={podStats}
      statsError={podStatsError}
      statsLoading={podStatsLoading}
      onNavigateToResource={navigateToResourceTarget}
    />
  )
  if (currentPath === '/namespaces' || currentPath === '/cluster/namespaces') {
    pageContent = <NamespacesPage />
  } else if (currentPath === '/pods') {
    pageContent = <PodsPage />
  } else if (informerResourceFromPath) {
    pageContent = <InformerResourcePage key={informerResourceFromPath} resource={informerResourceFromPath} />
  } else if (crdResourceFromPath) {
    pageContent = (
      <CRDResourceView
        key={`${crdResourceFromPath.group}/${crdResourceFromPath.plural}`}
        group={crdResourceFromPath.group}
        plural={crdResourceFromPath.plural}
        onNavigateBack={() => navigateTo('/crd-definitions')}
      />
    )
  } else if (currentPath === '/crd-definitions') {
    pageContent = <CRDDefinitionsPage />
  } else if (currentPath === '/settings') {
    pageContent = <SettingsPage />
  } else {
    pageContent = (
      <DashboardPage
        stats={podStats}
        statsError={podStatsError}
        statsLoading={podStatsLoading}
        onNavigateToResource={navigateToResourceTarget}
      />
    )
  }

  const healthyPct = Math.round((podStats.healthy / Math.max(1, podStats.total)) * 100)
  const healthStatus: 'healthy' | 'degraded' | 'down' = healthyPct >= 90 ? 'healthy' : healthyPct >= 70 ? 'degraded' : 'down'
  const sidebarHealth = {
    label: 'Health',
    value: `${healthyPct}%`,
    delta: `${podStats.healthy}/${podStats.total}`,
    status: healthStatus,
  }

  const showFooterProgress = Boolean(pendingActionLabel) || pendingRequests > 0
  const footerProgressItems = [
    ...(pendingActionLabel ? [`${pendingActionLabel}...`] : []),
    ...pendingRequestLabels,
  ]
  const footerProgressLabel = Array.from(new Set(footerProgressItems)).join(' | ')


  return (
    <div className="lucid-shell flex h-screen w-full overflow-hidden text-foreground gap-2 p-2">
      <ClusterRail currentContext={context} onDisconnected={() => {
        setIsInitialized(false)
        try { window.sessionStorage.removeItem(INIT_CONTEXT_SESSION_KEY) } catch { /* ignore */ }
        window.history.pushState({}, '', '/init')
        setCurrentPath(normalizePath('/init'))
      }} />
      <Sidebar userRole={userRole} health={sidebarHealth} currentPath={currentPath} onNavigate={(href) => navigateTo(href)} isClusterConnected={isInitialized} />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <AppChrome pageTitle={pageTitle} context={context} onSettings={() => navigateTo('/settings')} />
        {pageContent}
        <footer className="lucid-footer h-10 flex items-center justify-between px-6 text-[10px] text-muted-foreground font-mono overflow-hidden">
          <div className="flex items-center">
            <span className="truncate max-w-[200px]" title={clusterInfo?.fileName || 'kubeconfig'}>
              {clusterInfo?.fileName && clusterInfo.fileName.trim() ? clusterInfo.fileName : 'kubeconfig'}
            </span>
            <span className="mx-3 h-3 w-px bg-border shrink-0" />
            <span className="truncate max-w-[240px]" title={clusterInfo?.currentUser || 'admin'}>
              {clusterInfo?.currentUser && clusterInfo.currentUser.trim() ? clusterInfo.currentUser : 'admin'}
            </span>
            <span className="mx-3 h-3 w-px bg-border shrink-0" />
            <span className="truncate max-w-[160px]" title={clusterInfo?.serverVersion || 'v?.?.?'}>
              {clusterInfo?.serverVersion && clusterInfo.serverVersion.trim() ? clusterInfo.serverVersion : 'v?.?.?'}
            </span>
          </div>
          <div className="flex items-center gap-0">
            {showFooterProgress && (
              <>
                <span className="text-[9px] uppercase tracking-wider text-primary/80 whitespace-nowrap">
                  {footerProgressLabel}
                </span>
                <span className="mx-3 h-3 w-px bg-border/60 shrink-0" />
              </>
            )}
            <span className="flex items-center">
              <span>cpu <span className="text-emerald-400">{formatStat(appStats?.cpuPercent, 1)}%</span></span>
              <span className="mx-3 h-3 w-px bg-border/60 shrink-0" />
              <span>mem <span className="text-cyan-400">{formatStat(appStats?.vmsGB, 2)} GB</span></span>
            </span>
            <span className="mx-3 h-3 w-px bg-border/60 shrink-0" />
            <span className="text-muted-foreground/50">© 2026 KubeGUI</span>
          </div>
        </footer>
      </main>
    </div>
  )
}

function NodeRow({ name, ip, instanceType, cpu, ram, disk, pods, cordoned, drained, podAllocations, onOpenAction, onAllocationClick }: {
  name: string; ip: string; instanceType: string;
  cpu: number; ram: number; disk: number; pods: number;
  cordoned: boolean; drained: boolean;
  podAllocations: import('./hooks/useNodeWorkload').PodAllocation[];
  onOpenAction: (target: NodeActionTarget) => void;
  onAllocationClick: (alloc: import('./hooks/useNodeWorkload').PodAllocation) => void;
}) {
  const statusColor = drained
    ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
    : cordoned
    ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
  const statusLabel = drained ? 'Drained' : cordoned ? 'Cordoned' : 'Ready'

  const Gauge = ({ label, pct, color }: { label: string; pct: number; color: string }) => (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-label">{label}</span>
        <span className={`text-[10px] font-bold ${color}`}>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct > 85 ? 'bg-red-400' : pct > 65 ? 'bg-amber-400' : color.replace('text-', 'bg-')}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  )

  const sysPods = podAllocations.filter(p => p.category === 'system')
  const dsPods = podAllocations.filter(p => p.category === 'daemonset')
  const wlPods = podAllocations.filter(p => p.category === 'workload')

  return (
    <div
      className="lucid-panel rounded-xl p-4 flex flex-col gap-4 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all duration-150 active:scale-[0.995]"
      onClick={() => onOpenAction({ name, ip, instanceType, cpu, ram, disk, pods, cordoned, drained })}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground truncate font-label">{name}</p>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
            {ip !== 'n/a' ? `${ip} · ` : ''}{instanceType}
          </p>
        </div>
        <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>{statusLabel}</span>
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-3 gap-3">
        <Gauge label="CPU" pct={cpu} color="text-primary" />
        <Gauge label="RAM" pct={ram} color="text-violet-400" />
        <Gauge label="Disk" pct={disk} color="text-cyan-400" />
      </div>

      {/* Pod allocation dots */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-label">Pod Allocation</span>
          <span className="text-[9px] text-muted-foreground">{pods} pods</span>
        </div>
        <div className="flex flex-wrap gap-[3px]">
          {sysPods.map(p => (
            <button
              key={p.uid}
              type="button"
              title={`[sys] ${p.namespace}/${p.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onAllocationClick(p)
              }}
              className={`w-2 h-2 rounded-sm cursor-pointer ${p.health === 'failed' ? 'bg-red-400' : p.health === 'warning' ? 'bg-amber-400' : 'bg-blue-400/70'}`}
            />
          ))}
          {dsPods.map(p => (
            <button
              key={p.uid}
              type="button"
              title={`[ds] ${p.namespace}/${p.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onAllocationClick(p)
              }}
              className={`w-2 h-2 rounded-sm cursor-pointer ${p.health === 'failed' ? 'bg-red-400' : p.health === 'warning' ? 'bg-amber-400' : 'bg-violet-400/70'}`}
            />
          ))}
          {wlPods.map(p => (
            <button
              key={p.uid}
              type="button"
              title={`[wl] ${p.namespace}/${p.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onAllocationClick(p)
              }}
              className={`w-2 h-2 rounded-sm cursor-pointer ${p.health === 'failed' ? 'bg-red-400' : p.health === 'warning' ? 'bg-amber-400' : 'bg-emerald-400/70'}`}
            />
          ))}
          {podAllocations.length === 0 && (
            <span className="text-[9px] text-muted-foreground/50">No pods scheduled</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-blue-400/70 inline-block" />System ({sysPods.length})</span>
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-violet-400/70 inline-block" />DaemonSet ({dsPods.length})</span>
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-emerald-400/70 inline-block" />Workload ({wlPods.length})</span>
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value, delta, icon, deltaClass, iconClass, percent, barColor, onClick }: {
  title: string; value: string; delta: string; icon: React.ReactNode;
  deltaClass?: string; iconClass?: string; percent: number; barColor: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`lucid-panel rounded-xl p-4 flex flex-col gap-3 ${onClick ? 'cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-label">{title}</p>
          <p className="text-3xl font-bold font-headline mt-0.5">{value}</p>
        </div>
        <span className={`opacity-30 ${iconClass ?? ''}`}>{icon}</span>
      </div>
      <div className="space-y-1.5">
        <div className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
        <p className={`text-[11px] font-medium ${deltaClass ?? 'text-muted-foreground'}`}>{delta}</p>
      </div>
    </div>
  )
}

// â”€â”€â”€ NodeRowList â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NodeRowList({ name, ip, instanceType, cpu, ram, disk, pods, cordoned, drained, podAllocations, onOpenAction, onAllocationClick }: {
  name: string; ip: string; instanceType: string;
  cpu: number; ram: number; disk: number; pods: number;
  cordoned: boolean; drained: boolean;
  podAllocations: import('./hooks/useNodeWorkload').PodAllocation[];
  onOpenAction: (target: NodeActionTarget) => void;
  onAllocationClick: (alloc: import('./hooks/useNodeWorkload').PodAllocation) => void;
}) {
  const maxTiles = 120
  const pickTiles = (allocations: typeof podAllocations) => {
    if (allocations.length <= maxTiles) return allocations
    const buckets: Record<string, typeof allocations> = { system: [], daemonset: [], workload: [] }
    for (const a of allocations) (buckets[a.category] ??= []).push(a)
    const sampled: typeof allocations = []
    const order = ['workload', 'daemonset', 'system'] as const
    while (sampled.length < maxTiles) {
      let added = false
      for (const cat of order) {
        const next = buckets[cat].shift()
        if (!next) continue
        sampled.push(next)
        added = true
        if (sampled.length >= maxTiles) break
      }
      if (!added) break
    }
    return sampled
  }

  const tiles = pickTiles(podAllocations)
  const [tooltip, setTooltip] = useState<{
    alloc: import('./hooks/useNodeWorkload').PodAllocation
    tileId: string; x: number; y: number
  } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const getTileId = (alloc: import('./hooks/useNodeWorkload').PodAllocation, idx: number) =>
    alloc.uid || `${alloc.namespace}/${alloc.name}/${alloc.category}/${idx}`

  const showTip = (e: React.MouseEvent<HTMLElement>, alloc: import('./hooks/useNodeWorkload').PodAllocation, idx: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({ alloc, tileId: getTileId(alloc, idx), x: rect.left + rect.width / 2, y: rect.top })
  }
  const hideTip = () => { hideTimer.current = setTimeout(() => setTooltip(null), 60) }

  useEffect(() => {
    if (!tooltip) return
    const still = tiles.some((a, i) => getTileId(a, i) === tooltip.tileId)
    if (!still) setTooltip(null)
  }, [tiles, tooltip])

  const tileClass = (category: string, health: string) => {
    if (health === 'failed') return 'bg-red-600/75'
    if (health === 'warning') return 'bg-amber-500/70'
    return category === 'system' ? 'bg-emerald-800/90'
      : category === 'daemonset' ? 'bg-emerald-500/90'
      : 'bg-lime-400/90'
  }
  const catColor = (category: string, health: string) => {
    if (health === 'failed') return '#dc2626'
    if (health === 'warning') return '#f59e0b'
    return category === 'system' ? '#1d5945' : category === 'daemonset' ? '#39a97b' : '#a3e635'
  }
  const catLabel = (category: string) =>
    category === 'system' ? 'System' : category === 'daemonset' ? 'DaemonSet' : 'Workload'

  const target: NodeActionTarget = { name, ip, instanceType, cpu, ram, disk, pods, cordoned, drained }

  return (
    <div
      className="group relative lucid-panel rounded-lg overflow-hidden cursor-pointer transition-colors hover:bg-surface-container-high/35 focus-within:bg-surface-container-high/35"
      role="button" tabIndex={0}
      onClick={() => onOpenAction(target)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenAction(target) } }}
    >
      {tooltip && createPortal(
        <div className="pointer-events-none" style={{ position: 'fixed', left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%,-100%)', zIndex: 9999 }}>
          <div style={{ background: '#0f172a', border: `1px solid ${catColor(tooltip.alloc.category, tooltip.alloc.health)}`, borderRadius: 8, padding: '8px 12px', minWidth: 180, maxWidth: 260, boxShadow: '0 6px 28px rgba(0,0,0,0.65)', fontFamily: "'JetBrains Mono',monospace" }}>
            <p style={{ fontWeight: 700, color: '#f0fdf4', fontSize: 11, wordBreak: 'break-all', marginBottom: 4 }}>{tooltip.alloc.name}</p>
            <p style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>
              <span style={{ color: '#475569' }}>ns </span>{tooltip.alloc.namespace}
            </p>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 7px' }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: catColor(tooltip.alloc.category, tooltip.alloc.health) }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: catColor(tooltip.alloc.category, tooltip.alloc.health) }}>
                {catLabel(tooltip.alloc.category)} · {tooltip.alloc.health}
              </span>
            </span>
          </div>
          <div style={{ width: 0, height: 0, margin: '0 auto', borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `5px solid ${catColor(tooltip.alloc.category, tooltip.alloc.health)}` }} />
        </div>,
        document.body,
      )}
      <div className="pointer-events-none absolute right-2 top-2 text-muted-foreground/60 transition-colors group-hover:text-primary/80">
        <ArrowUpRight size={12} />
      </div>
      <div className="grid grid-cols-12">
        {/* Left: node info + stats */}
        <div className="col-span-4 p-4 border-r border-border/30 flex items-center justify-between bg-surface-container-low/35">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-8 w-8 rounded lucid-control flex items-center justify-center text-primary shrink-0">
              <Database size={14} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{name}</p>
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-muted-foreground">
                {ip !== 'n/a' && <span>{ip}</span>}
                {instanceType && <span>{instanceType}</span>}
                {cordoned && (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[9px] uppercase tracking-wide">
                    <ShieldAlert size={9} /> cordoned
                  </span>
                )}
                {drained && (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[9px] uppercase tracking-wide">
                    <Wind size={9} /> drained
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-2">
            <div className="text-center"><p className="text-[8px] text-muted-foreground uppercase">CPU</p><p className={`text-[10px] font-bold ${cpu >= 80 ? 'text-amber-400' : ''}`}>{cpu}%</p></div>
            <div className="text-center"><p className="text-[8px] text-muted-foreground uppercase">RAM</p><p className={`text-[10px] font-bold ${ram >= 80 ? 'text-amber-400' : ''}`}>{ram}%</p></div>
            <div className="text-center"><p className="text-[8px] text-muted-foreground uppercase">Disk</p><p className={`text-[10px] font-bold ${disk >= 80 ? 'text-amber-400' : ''}`}>{disk}%</p></div>
            <div className="text-center"><p className="text-[8px] text-muted-foreground uppercase">Pods</p><p className="text-[10px] font-bold">{pods}</p></div>
          </div>
        </div>
        {/* Right: pod allocation dots */}
        <div className="col-span-8 p-4 flex items-center">
          <div className="flex flex-wrap gap-[3px] flex-1">
            {tiles.map((alloc, idx) => (
              <button
                key={getTileId(alloc, idx)}
                type="button"
                className={`w-3 h-3 rounded-sm cursor-pointer ${tileClass(alloc.category, alloc.health)}`}
                onMouseEnter={(e) => showTip(e, alloc, idx)}
                onMouseLeave={hideTip}
                onClick={(e) => {
                  e.stopPropagation()
                  onAllocationClick(alloc)
                }}
              />
            ))}
            {podAllocations.length > maxTiles && (
              <span className="text-[10px] text-muted-foreground ml-2">+{podAllocations.length - maxTiles}</span>
            )}
            {podAllocations.length === 0 && (
              <span className="text-[10px] text-muted-foreground/40">No pods scheduled</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DashboardPage({
  stats,
  statsError,
  statsLoading,
  onNavigateToResource,
}: {
  stats: PodStats
  statsError: string | null
  statsLoading: boolean
  onNavigateToResource: (target: AllocationNavigationTarget) => void
}) {
  const { logs, error: logsError, isLoading: logsLoading } = useSystemLogs(10)
  const { events, error: eventsError, isLoading: eventsLoading } = useSystemEvents('kube-system', 10)
  const { nodes: rawNodes, activeNodes, isLoading: nodesLoading } = useNodeWorkload()
  const { metrics: nodeMetrics } = useNodeMetrics()

  // Overlay real live metrics onto raw node workload data
  const nodes = rawNodes.map((n) => {
    const live = nodeMetrics.get(n.name)
    if (!live) return n
    const nextPodCount = live.pods > 0 ? live.pods : n.podCount
    return {
      ...n,
      cpuPercent:  Math.round(live.cpu),
      ramPercent:  Math.round(live.ram),
      diskPercent: Math.round(live.disk),
      podCount:    nextPodCount,
      drained: n.cordoned && nextPodCount === 0,
    }
  })

  const [nodeSearch, setNodeSearch] = usePersistentState('dashboard:nodes:search', '')
  const [nodeSort, setNodeSort] = usePersistentState<'name' | 'pods' | 'cpu' | 'ram' | 'disk'>('dashboard:nodes:sort', 'name')
  const [nodeSortDir, setNodeSortDir] = usePersistentState<'asc' | 'desc'>('dashboard:nodes:sort-dir', 'asc')
  const [nodeView, setNodeView] = usePersistentState<'cards' | 'table'>('dashboard:nodes:view', 'table')
  const [actionNode, setActionNode] = useState<NodeActionTarget | null>(null)
  const [actionTab, setActionTab] = usePersistentState<DrawerTab>('dashboard:nodes:action-tab', 'overview')

  const filteredNodes = useMemo(() => {
    const q = nodeSearch.trim().toLowerCase()
    const list = q
      ? nodes.filter((n) => n.name.toLowerCase().includes(q) || n.ip.includes(q) || n.instanceType.toLowerCase().includes(q))
      : [...nodes]

    list.sort((a, b) => {
      let cmp = 0
      if (nodeSort === 'name') cmp = a.name.localeCompare(b.name)
      else if (nodeSort === 'pods') cmp = a.podCount - b.podCount
      else if (nodeSort === 'cpu') cmp = a.cpuPercent - b.cpuPercent
      else if (nodeSort === 'ram') cmp = a.ramPercent - b.ramPercent
      else if (nodeSort === 'disk') cmp = a.diskPercent - b.diskPercent
      return nodeSortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [nodes, nodeSearch, nodeSort, nodeSortDir])

   const toggleSort = (field: typeof nodeSort) => {
     if (nodeSort === field) setNodeSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
     else { setNodeSort(field); setNodeSortDir('asc') }
   }

   const handleCordonChange = (nodeName: string, cordoned: boolean) => {
     if (actionNode && actionNode.name === nodeName) {
       setActionNode({
         ...actionNode,
         cordoned,
       })
     }
   }

    return (
      <div className="flex-1 overflow-y-auto p-8 space-y-8">
            <NodeActionDrawer
              node={actionNode}
              initialTab={actionTab}
              onClose={() => setActionNode(null)}
              onCordonChange={handleCordonChange}
            />
            {statsLoading ? (
              <StatCardsSkeleton />
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard title="Total Pods" value={String(stats.total)} delta={`+${Math.max(0, stats.total - 236)}`} icon={<Boxes size={32} />} deltaClass="text-emerald-400" percent={Math.min(100, Math.round((stats.total / Math.max(1, stats.total)) * 100))} barColor="bg-primary" />
              <StatCard title="Healthy" value={String(stats.healthy)} delta={`${Math.round((stats.healthy / Math.max(1, stats.total)) * 100)}% UP`} icon={<CheckCircle2 size={32} />} deltaClass="text-muted-foreground" iconClass="text-emerald-400" percent={Math.round((stats.healthy / Math.max(1, stats.total)) * 100)} barColor="bg-emerald-400" />
              <StatCard title="Warnings" value={String(stats.warnings)} delta={stats.total > 0 ? `${Math.round((stats.warnings / stats.total) * 100)}% of pods` : '—'} icon={<TriangleAlert size={32} />} deltaClass="text-amber-400/80" iconClass="text-amber-400" percent={stats.total > 0 ? Math.round((stats.warnings / stats.total) * 100) : 0} barColor="bg-amber-400" onClick={() => onNavigateToResource({ resource: 'pods', namespace: 'all', name: '', statusFilter: 'warnings' })} />
              <StatCard title="Failed" value={String(stats.failed)} delta={stats.total > 0 ? `${Math.round((stats.failed / stats.total) * 100)}% of pods` : '—'} icon={<XCircle size={32} />} deltaClass="text-red-400/80" iconClass="text-red-400" percent={stats.total > 0 ? Math.round((stats.failed / stats.total) * 100) : 0} barColor="bg-red-400" />
            </div>
            )}
            {statsError && <div className="text-sm text-red-400 mt-1">Stats error: {statsError}</div>}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">Nodes Workload Allocation</h4>
                <span className="lucid-chip text-[10px] font-medium px-2 py-0.5 rounded-full">{activeNodes} NODES ACTIVE</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    className="lucid-control rounded-md pl-7 pr-3 py-1 text-[11px] w-48 focus:outline-none"
                    placeholder="Search nodes…"
                    value={nodeSearch}
                    onChange={(e) => setNodeSearch(e.target.value)}
                  />
                </div>
                {/* Sort buttons */}
                <div className="flex items-center gap-1 text-[10px]">
                  {(['name', 'pods', 'cpu', 'ram', 'disk'] as const).map((f) => (
                    <UiTooltip key={f} content={`Sort nodes by ${f}`}>
                      <button
                        onClick={() => toggleSort(f)}
                        className={`px-2 py-1 rounded font-bold uppercase tracking-wider transition-colors ${
                          nodeSort === f
                             ? 'bg-primary/20 text-primary rounded-md'
                             : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md'
                        }`}
                      >
                        {f}{nodeSort === f ? (nodeSortDir === 'asc' ? ' ↑' : ' ←') : ''}
                      </button>
                    </UiTooltip>
                  ))}
                </div>
                {/* View toggle */}
                <div className="flex items-center rounded-md border border-border/50 overflow-hidden">
                  <UiTooltip content="Cards view">
                    <button
                      onClick={() => setNodeView('cards')}
                      className={`px-2 py-1.5 transition-colors ${nodeView === 'cards' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}`}
                    >
                      <LayoutGrid size={12} />
                    </button>
                  </UiTooltip>
                  <UiTooltip content="Table view">
                    <button
                      onClick={() => setNodeView('table')}
                      className={`px-2 py-1.5 transition-colors ${nodeView === 'table' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}`}
                    >
                      <LayoutList size={12} />
                    </button>
                  </UiTooltip>
                </div>
              </div>
            </div>

            {nodeView === 'cards' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredNodes.map((node) => (
                  <NodeRow
                    key={node.name}
                    name={node.name}
                    ip={node.ip}
                    instanceType={node.instanceType}
                    cpu={node.cpuPercent}
                    ram={node.ramPercent}
                    disk={node.diskPercent}
                    pods={node.podCount}
                    cordoned={node.cordoned}
                    drained={node.drained}
                    podAllocations={node.podAllocations}
                    onOpenAction={(target) => {
                      setActionNode(target)
                      setActionTab('overview')
                    }}
                    onAllocationClick={(alloc) => onNavigateToResource(allocationTargetFromPod(alloc))}
                  />
                ))}
                {filteredNodes.length === 0 && (
                  nodeSearch
                    ? <p className="col-span-full text-sm text-muted-foreground/60 py-4">No nodes match your search.</p>
                    : <NodeCardsSkeleton count={nodesLoading ? 4 : 0} />
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredNodes.map((node) => (
                  <NodeRowList
                    key={node.name}
                    name={node.name}
                    ip={node.ip}
                    instanceType={node.instanceType}
                    cpu={node.cpuPercent}
                    ram={node.ramPercent}
                    disk={node.diskPercent}
                    pods={node.podCount}
                    cordoned={node.cordoned}
                    drained={node.drained}
                    podAllocations={node.podAllocations}
                    onOpenAction={(target) => {
                      setActionNode(target)
                      setActionTab('overview')
                    }}
                    onAllocationClick={(alloc) => onNavigateToResource(allocationTargetFromPod(alloc))}
                  />
                ))}
                {filteredNodes.length === 0 && !nodeSearch && (
                  <NodeTableSkeleton count={nodesLoading ? 4 : 0} />
                )}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            <section className="lg:col-span-3 lucid-panel rounded-lg flex flex-col min-h-[280px] overflow-hidden">
              <div className="p-4 border-b border-border/30 flex justify-between items-center bg-surface-container-low/50">
                <div className="flex items-center gap-2">
                  <Terminal size={14} />
                  <h5 className="text-sm font-semibold uppercase tracking-wider">Live Cluster Logs</h5>
                </div>
                <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] font-bold text-emerald-400 uppercase">Live</span>
                </div>
              </div>
              <div className="p-4 font-mono text-[11px] leading-relaxed space-y-1.5 overflow-y-auto max-h-[260px]">
                {logsError && logs.length === 0 && (
                  <p className="text-red-400">Error: {logsError}</p>
                )}
                {!logsError && logs.length === 0 && (
                  logsLoading ? <LogLinesSkeleton count={6} /> : <p className="text-muted-foreground/50">No system logs found...</p>
                )}
                {logs.map((log, i) => {
                  const t = new Date(log.timestamp)
                  const hms = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                  const isWarn = log.level === 'WARN'
                  const isError = log.level === 'ERROR'
                  return (
                    <p key={i}>
                      <span className="text-muted-foreground/50 mr-3">{hms}</span>
                      <span className={`mr-2 ${isError ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-emerald-400'}`}>
                        [{log.level}]
                      </span>
                      <span className="text-primary mr-1">{log.component}</span>
                      <span className="text-muted-foreground"> {log.message}</span>
                    </p>
                  )
                })}
              </div>
            </section>

            <section className="lg:col-span-2 lucid-panel rounded-lg flex flex-col min-h-[280px] overflow-hidden">
              <div className="p-4 border-b border-border/30 flex justify-between items-center bg-surface-container-low/50">
                <div className="flex items-center gap-2">
                  <Radio size={14} />
                  <h5 className="text-sm font-semibold uppercase tracking-wider">Cluster Events</h5>
                  <span className="text-[9px] text-muted-foreground font-mono">kube-system</span>
                </div>
              </div>
              <div className={`p-4 font-mono text-[11px] leading-relaxed space-y-1.5 overflow-y-auto max-h-[260px] ${
                eventsError ? 'border-t border-red-500/20 bg-red-500/5' : ''
              }`}>
                {eventsError && (
                  <p className="text-red-400">Error: {eventsError}</p>
                )}
                {!eventsError && events.length === 0 && (
                  eventsLoading ? <EventLinesSkeleton count={5} /> : <p className="text-muted-foreground/50">No events found…</p>
                )}
                {events.map((ev, i) => {
                  const t = new Date(ev.time)
                  const hms = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                  const isWarn = ev.type === 'Warning'
                  const message = String(ev.message ?? '').trim()
                  const reason = String(ev.reason ?? '').trim()
                  const detail = message && message !== reason ?
                    (message.startsWith(reason) ? message.slice(reason.length).trim().replace(/^[-–—:]*\s*/, '') : message)
                    : ''
                  return (
                    <p key={i}>
                      <span className="text-muted-foreground/50 mr-3">{hms}</span>
                      <span className={`mr-2 ${isWarn ? 'text-amber-400' : 'text-emerald-400'}`}>
                        [{isWarn ? 'WARN' : 'INFO'}]
                      </span>
                      <span className="text-primary mr-1">{reason || detail || 'event'}</span>
                      {detail && (
                        <span className="text-muted-foreground/70 text-[10px]">- {detail}</span>
                      )}
                      {ev.object && !detail && (
                        <span className="text-muted-foreground/70 text-[10px] ml-1">{ev.object}</span>
                      )}
                    </p>
                  )
                })}
              </div>
            </section>
          </div>
        </div>
  )
}

function SettingsPage() {
  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h3 className="text-3xl font-bold tracking-tight font-headline">Settings</h3>
      <p className="text-sm text-muted-foreground mt-2">Settings coming soon.</p>
    </div>
  )
}

function NamespacesPage() {
  type NamespaceRow = {
    name: string
    phase: string
    createdAt: string
    labels: Record<string, string>
  }

  const [items, setItems] = useState<NamespaceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [globalFilter, setGlobalFilter] = useState('')
  const [selectedNamespaceRow, setSelectedNamespaceRow] = useState<NamespaceActionTarget | null>(null)
  const [selectedNamespaceTab, setSelectedNamespaceTab] = useState<'overview' | 'edit'>('overview')
  const [selectedNamespaceRows, setSelectedNamespaceRows] = useState<NamespaceRow[]>([])
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [rowSelectionResetKey, setRowSelectionResetKey] = useState(0)
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false)
  const [namespacesLoading, setNamespacesLoading] = useState(false)
  const [namespaceStreamError, setNamespaceStreamError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const toNamespaceRow = useCallback((ns: Record<string, unknown>) => {
    const meta = (ns.metadata as Record<string, unknown> | undefined) ?? {}
    const status = (ns.status as Record<string, unknown> | undefined) ?? {}
    const rawLabels = (meta.labels as Record<string, unknown> | undefined) ?? {}
    const labels = Object.entries(rawLabels).reduce<Record<string, string>>((acc, [k, v]) => {
      acc[k] = String(v)
      return acc
    }, {})

    return {
      name: String(meta.name ?? 'unknown'),
      phase: String(status.phase ?? 'Unknown'),
      createdAt: String(meta.creationTimestamp ?? ''),
      labels,
    }
  }, [])

  const humanAge = (timestamp: string) => {
    const compact = formatAge(timestamp)
    if (compact === '—') return compact
    return `${compact} ago`
  }

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setNamespacesLoading(true)
      try {
        const list = await listNamespacesViaBinding()
        const mapped = list.map((ns) => toNamespaceRow(ns as Record<string, unknown>))
        if (!cancelled) {
          setItems(mapped)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'fetch error')
      } finally {
        if (!cancelled) setNamespacesLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [toNamespaceRow])

  useEffect(() => {
    if (namespacesLoading) return

    const reload = async () => {
      try {
        const list = await listNamespacesViaBinding()
        setItems(list.map((ns) => toNamespaceRow(ns as Record<string, unknown>)))
        setNamespaceStreamError(null)
      } catch { /* ignore reload errors */ }
    }

    const off = Events.On('namespacesInformerChanged', () => { void reload() })
    const interval = window.setInterval(() => { void reload() }, 30000)

    return () => {
      off()
      clearInterval(interval)
      setNamespaceStreamError(null)
    }
  }, [namespacesLoading, toNamespaceRow])


  const selectedNamespaceNames = useMemo(
    () => selectedNamespaceRows.map((row) => row.name).join(', '),
    [selectedNamespaceRows],
  )


  const deleteSelectedNamespaces = useCallback(async () => {
    if (selectedNamespaceRows.length === 0 || bulkDeleteBusy) return
    const names = selectedNamespaceRows.map((row) => row.name)

    setBulkDeleteBusy(true)
    try {
      const results = await Promise.allSettled(
        names.map(async (name) => {
          await ResourceDelete('namespaces', '_', name)
          return name
        }),
      )

      const deletedNames: string[] = []
      const failedReasons: string[] = []

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          deletedNames.push(result.value)
        } else {
          failedReasons.push(result.reason instanceof Error ? result.reason.message : 'Delete failed')
        }
      })

      if (deletedNames.length > 0) {
        const deletedSet = new Set(deletedNames)
        setItems((prev) => prev.filter((item) => !deletedSet.has(item.name)))
      }
      setSelectedNamespaceRows([])
      setRowSelectionResetKey((n) => n + 1)

      if (failedReasons.length === 0) {
        uiNotify.success(`Deleted ${deletedNames.length} namespace(s)`)
      } else {
        uiNotify.error(`Deleted ${deletedNames.length}/${names.length}. ${failedReasons[0]}`)
      }
    } finally {
      setBulkDeleteBusy(false)
    }
  }, [selectedNamespaceRows, bulkDeleteBusy])

  const columns = useMemo<ColumnDef<NamespaceRow>[]>(
    () => [
      {
        id: 'select',
        header: 'select',
        accessorKey: 'name',
        enableSorting: false,
        size: 44,
        meta: { thClassName: 'pl-3', tdClassName: 'pl-3' },
        cell: (info) => {
          return (
            <input
              type="checkbox"
              className="w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]"
              checked={info.row.getIsSelected()}
              onChange={info.row.getToggleSelectedHandler()}
              onClick={(e) => e.stopPropagation()}
            />
          )
        },
      },
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        cell: (info) => <span className="font-label text-sm text-foreground font-semibold">{String(info.getValue())}</span>,
      },
      {
        id: 'labels',
        header: 'Labels',
        accessorFn: (row) => Object.entries(row.labels).map(([k, v]) => `${k}: ${v}`).join(' '),
        enableSorting: false,
        meta: { fixedWidth: 420 },
        cell: (info) => {
          const entries = Object.entries(info.row.original.labels)
          if (entries.length === 0) return <span className="text-sm text-muted-foreground/40">—</span>
          return (
            <div className="flex flex-col gap-0.5">
              {entries.map(([k, v]) => (
                <span key={k} className="text-[11px] text-muted-foreground leading-4">
                  <span className="text-outline">{k}</span>: {v}
                </span>
              ))}
            </div>
          )
        },
      },
      {
        id: 'age',
        header: 'Age',
        accessorFn: (row) => row.createdAt,
        sortingFn: 'datetime',
        meta: { shrink: true, fixedWidth: 110, disableOverflowTooltip: true },
        cell: (info) => {
          const phase = info.row.original.phase
          const isActive = phase.toLowerCase() === 'active'
          return (
            <div className="flex flex-col gap-1 min-w-[80px]">
              <span className="text-sm text-muted-foreground whitespace-nowrap">{humanAge(String(info.getValue() ?? ''))}</span>
              <UiTooltip content={phase}>
                <div className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden cursor-help">
                  <div className={`h-full w-full rounded-full ${isActive ? 'bg-emerald-400/70' : 'bg-red-400/70'}`} />
                </div>
              </UiTooltip>
            </div>
          )
        },
      },
    ],
    [],
  )


  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      {showCreateModal && (
        <CreateResourceModal
          resource="namespaces"
          label="Namespace"
          onClose={() => setShowCreateModal(false)}
          onCreated={async () => {
            try {
              const list = await listNamespacesViaBinding()
              setItems(list.map((ns) => toNamespaceRow(ns as Record<string, unknown>)))
            } catch { /* ignore */ }
          }}
        />
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">Namespaces</h3>
          <p className="text-sm text-muted-foreground">Manage namespace scope and lifecycle.</p>
        </div>
        <button type="button" onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/20 transition-all duration-150 active:scale-[0.97]">
          <span className="flex items-center justify-center w-4 h-4 rounded bg-primary text-primary-foreground shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </span>
          New Namespace
        </button>
      </div>
      {error && <p className="text-sm text-red-400">Error: {error}</p>}
      {namespaceStreamError && !error && (
        <div className="px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-sm shrink-0">
          {namespaceStreamError}
        </div>
      )}
      <div id="namespaces-toolbar" className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Filter namespaces..."
              className="lucid-control rounded pl-7 pr-3 py-1 text-xxs min-w-[220px] focus:outline-none font-label"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {selectedNamespaceRows.length > 0 && (
            <div className="lucid-control flex items-center gap-1.5 rounded text-sm focus:outline-none px-2 py-1.5 bg-[#0f172a80]">
              <span className="text-[10px] tracking-wider text-muted-foreground max-w-[460px] truncate" title={selectedNamespaceNames}>
                Selected namespaces: {selectedNamespaceNames}
              </span>
              <button
                type="button"
                onClick={() => setConfirmBulkDeleteOpen(true)}
                disabled={bulkDeleteBusy}
                className="px-1 py-0 rounded text-[10px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {bulkDeleteBusy ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{items.length} namespaces</span>
      </div>
      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={items}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={52}
          emptyLabel="No namespaces found."
          loading={namespacesLoading}
          columnOrder={['select', 'name', 'labels', 'age']}
          persistKey="namespaces"
          onSelectedRowsChange={setSelectedNamespaceRows}
          rowSelectionResetKey={rowSelectionResetKey}
          onRowClick={(row) => {
            setSelectedNamespaceTab('overview')
            setSelectedNamespaceRow({
              name: row.name,
              phase: row.phase,
              createdAt: row.createdAt,
              labels: row.labels,
            })
          }}
        />
      </div>

      {selectedNamespaceRow && (
        <NamespaceActionDrawer
          namespace={selectedNamespaceRow}
          initialTab={selectedNamespaceTab}
          onClose={() => setSelectedNamespaceRow(null)}
          onDeleted={(name) => {
            setItems((prev) => prev.filter((item) => item.name !== name))
          }}
        />
      )}

      <ConfirmDialog
        open={confirmBulkDeleteOpen}
        title={`Delete ${selectedNamespaceRows.length} namespace(s)?`}
        description={`Selected: ${selectedNamespaceNames}`}
        confirmLabel={`Delete ${selectedNamespaceRows.length} namespace(s)`}
        onConfirm={() => { setConfirmBulkDeleteOpen(false); void deleteSelectedNamespaces() }}
        onCancel={() => setConfirmBulkDeleteOpen(false)}
      />
    </div>
  )
}


// --- Generic create-resource slide-in modal ---
function CreateResourceModal({ resource, label, onClose, onCreated }: { resource: string; label: string; onClose: () => void; onCreated?: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<ReturnType<LegacyAce['edit']> | null>(null)
  const [busy, setBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [hasSyntaxError, setHasSyntaxError] = useState(false)
  const [visible, setVisible] = useState(false)
  const [editorLoading, setEditorLoading] = useState(true)

  const defaultYaml = RESOURCE_YAML_TEMPLATES[resource] ?? `apiVersion: v1\nkind: ${label}\nmetadata:\n  name: my-resource\nspec: {}\n`
  // Keep a ref so the ACE init effect can read yaml without stale-closure issues
  const defaultYamlRef = useRef(defaultYaml)
  defaultYamlRef.current = defaultYaml
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])
  const destroyEditor = () => {
    const editor = editorRef.current
    editorRef.current = null
    if (editor) { try { editor.destroy() } catch { /* ignore */ } }
    if (containerRef.current) containerRef.current.innerHTML = ''
  }
  const handleClose = () => {
    destroyEditor()
    setVisible(false)
    setTimeout(onClose, 200)
  }
  useEffect(() => {
    let destroyed = false
    const initEditor = async () => {
      const containerEl = containerRef.current
      if (!containerEl) return
      try {
        const { ensureLegacyEditorAssets } = await import('./components/ui/podLegacyAssets')
        await ensureLegacyEditorAssets()
        if (destroyed || editorRef.current) return
        const win = window as JsYamlWindow
        if (!win.ace) { setEditorError('Ace editor not available'); return }
        const editor = win.ace.edit(containerEl)
        configureAceYamlEditor(editor, { onValidationChange: setHasSyntaxError })
        editor.setValue(defaultYamlRef.current, -1)
        editor.getSession().getUndoManager().markClean()
        editorRef.current = editor
        await new Promise<void>(r => requestAnimationFrame(() => r()))
        if (destroyed) return
        editor.resize?.(true)
        editor.renderer?.updateFull(true)
        editor.scrollToRow?.(0)
        if (!destroyed) setEditorLoading(false)
      } catch (e) {
        if (!destroyed) setEditorError(e instanceof Error ? e.message : 'Failed to load editor')
      }
    }
    void initEditor()
    return () => {
      destroyed = true
      const editor = editorRef.current
      editorRef.current = null
      if (editor) { try { editor.destroy() } catch { /* ignore */ } }
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const handleCreate = async () => {
    setSubmitError(null)
    if (hasSyntaxError) {
      setSubmitError('YAML validation failed. Fix editor errors before creating.')
      return
    }
    const win = window as JsYamlWindow
    const yaml = editorRef.current?.getValue() ?? defaultYamlRef.current
    let obj: unknown
    try {
      obj = win.jsyaml ? win.jsyaml.load(yaml) : JSON.parse(yaml)
    } catch (e) {
      setSubmitError(`Invalid YAML: ${e instanceof Error ? e.message : 'parse error'}`)
      return
    }
    const meta = (obj as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined
    const name = String(meta?.name ?? '').trim()
    const ns = String(meta?.namespace ?? '').trim()
    if (!name) { setSubmitError('metadata.name is required'); return }

    setBusy(true)
    try {
      await ResourceAdd(resource, JSON.stringify(obj))
      uiNotify.success(`${label} "${name}"${ns ? ` in namespace "${ns}"` : ''} created`)
      destroyEditor()
      onCreated?.()
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[999] transition-opacity duration-200 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={handleClose}
      />
      <div
        className={`fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[760px] max-w-[100vw] z-[1000] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>
              <span className="font-mono text-sm font-bold text-foreground">New {label}</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">Edit the YAML manifest and click Create</p>
          </div>
          <button onClick={handleClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {submitError && (
          <div className="mx-4 mt-3 shrink-0 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span className="break-all">{submitError}</span>
            <button onClick={() => setSubmitError(null)} className="ml-auto shrink-0 hover:text-red-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-3">
          <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden" style={{ minHeight: "200px" }}>
            <div ref={containerRef} style={{ position: "absolute", inset: 0, color: "#dedede" }} />
            {editorLoading && !editorError && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Loading editor…
              </div>
            )}
            {editorError && (
              <div className="absolute inset-0 p-4 text-red-400 text-sm">{editorError}</div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-accent/10 shrink-0">
          <button type="button" onClick={handleClose} disabled={busy} className="px-4 py-1.5 rounded text-sm font-semibold text-muted-foreground border border-border hover:text-foreground transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleCreate()} disabled={busy || hasSyntaxError} className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90">
            {busy ? 'Creating…' : 'Create Namespace'}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
type PodStatusFilter = 'all' | 'running' | 'restarting' | 'warning' | 'error' | 'terminating'

function podStatusFilterLabel(f: PodStatusFilter): string {
  switch (f) {
    case 'all': return 'All'
    case 'running': return 'Running'
    case 'restarting': return 'Restarting'
    case 'warning': return 'Warning'
    case 'error': return 'Error'
    case 'terminating': return 'Terminating'
  }
}
function podMatchesStatusFilter(pod: PodRow, filter: PodStatusFilter): boolean {
  if (filter === 'all') return true
  const n = (pod.statusText || pod.phase || '').toLowerCase()
  if (filter === 'running') return n === 'running' || n === 'succeeded' || n === 'completed'
  if (filter === 'terminating') return n === 'terminating'
  if (filter === 'restarting') return pod.restarts > 0
  if (filter === 'error') {
    return n === 'failed' || n === 'crashloopbackoff' || n === 'oomkilled' || n === 'error' ||
      n === 'imagepullbackoff' || n === 'errimagepull' || n === 'evicted' || n === 'nodenotready'
  }
  if (filter === 'warning') {
    const isHealthy = n === 'running' || n === 'succeeded' || n === 'completed'
    const isError = n === 'failed' || n === 'crashloopbackoff' || n === 'oomkilled' || n === 'error' ||
      n === 'imagepullbackoff' || n === 'errimagepull' || n === 'evicted' || n === 'nodenotready'
    const isTerminating = n === 'terminating'
    return !isHealthy && !isError && !isTerminating
  }
  return true
}
function PodsPage() {

  const navigationFilter = useMemo(() => readNavigationFilterFromUrl(), [])
  const urlFilterHydratedRef = useRef(false)

  const [items, setItems] = useState<PodRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [globalFilter, setGlobalFilter] = useState(navigationFilter.query)
  const [selectedNamespace, setSelectedNamespace] = usePersistentState('pods:namespace', navigationFilter.namespace || 'all')
  const { namespaces: namespaceList } = useNamespaceOptions()
  const namespaces = useMemo(() => ['all', ...namespaceList], [namespaceList])
  const [loading, setLoading] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [selectedPod, setSelectedPod] = useState<PodRow | null>(null)
  const [selectedPodTab, setSelectedPodTab] = useState<'overview' | 'events' | 'logs' | 'shell' | 'edit'>('overview')
  const [showCreatePodModal, setShowCreatePodModal] = useState(false)
  const [selectedPodRows, setSelectedPodRows] = useState<PodRow[]>([])
  const [podBulkDeleteBusy, setPodBulkDeleteBusy] = useState(false)
  const [podRowSelectionResetKey, setPodRowSelectionResetKey] = useState(0)
  const [confirmBulkDeletePodsOpen, setConfirmBulkDeletePodsOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<PodStatusFilter>('all')

  const filteredItems = useMemo(
    () => items.filter((pod) => podMatchesStatusFilter(pod, statusFilter)),
    [items, statusFilter],
  )

  const statusFilterCounts = useMemo<Record<PodStatusFilter, number>>(() => {
    const counts: Record<PodStatusFilter, number> = { all: items.length, running: 0, restarting: 0, warning: 0, error: 0, terminating: 0 }
    const fs: PodStatusFilter[] = ['running', 'restarting', 'warning', 'error', 'terminating']
    for (const f of fs) { counts[f] = items.filter((pod) => podMatchesStatusFilter(pod, f)).length }
    return counts
  }, [items])

  useEffect(() => {
    if (urlFilterHydratedRef.current) return
    urlFilterHydratedRef.current = true
    if (navigationFilter.namespace && navigationFilter.namespace !== selectedNamespace) {
      setSelectedNamespace(navigationFilter.namespace)
    }
    if (navigationFilter.query && navigationFilter.query !== globalFilter) {
      setGlobalFilter(navigationFilter.query)
    }
    if (navigationFilter.filter) {
      const filterMap: Record<string, PodStatusFilter> = { warnings: 'warning', warning: 'warning', failed: 'error', error: 'error' }
      const mapped = filterMap[navigationFilter.filter]
      if (mapped) setStatusFilter(mapped)
    }
  }, [globalFilter, navigationFilter.filter, navigationFilter.namespace, navigationFilter.query, selectedNamespace, setSelectedNamespace, setStatusFilter])


  const toPodStatus = (pod: Record<string, unknown>) => {
    const meta = (pod.metadata as Record<string, unknown> | undefined) ?? {}
    const status = (pod.status as Record<string, unknown> | undefined) ?? {}
    const phase = String(status.phase ?? 'Unknown')

    const deletionTimestamp = String(meta.deletionTimestamp ?? '')
    if (deletionTimestamp) {
      return { phase, statusText: 'Terminating' }
    }

    const statuses = Array.isArray(status.containerStatuses)
      ? (status.containerStatuses as Array<Record<string, unknown>>)
      : []

    const waitingReasons = statuses
      .map((s) => ((s.state as Record<string, unknown> | undefined)?.waiting as Record<string, unknown> | undefined))
      .map((w) => String(w?.reason ?? '').trim())
      .filter(Boolean)

    const terminatedReasons = statuses
      .map((s) => ((s.state as Record<string, unknown> | undefined)?.terminated as Record<string, unknown> | undefined))
      .map((t) => ({
        reason: String(t?.reason ?? '').trim(),
        exitCode: Number(t?.exitCode ?? 0),
      }))
      .filter((t) => t.reason || t.exitCode !== 0)

    const allReady = statuses.length > 0 && statuses.every((s) => Boolean(s.ready))
    const readyCondition = Array.isArray(status.conditions)
      ? (status.conditions as Array<Record<string, unknown>>).find((c) => String(c.type ?? '') === 'Ready')
      : undefined
    const isReadyConditionTrue = String(readyCondition?.status ?? '') === 'True'

    const podReason = String(status.reason ?? '').trim()

    if (waitingReasons.length > 0) {
      return { phase, statusText: waitingReasons[0] }
    }

    if (terminatedReasons.length > 0) {
      return { phase, statusText: terminatedReasons[0].reason || 'Terminated' }
    }

    if (phase === 'Running') {
      if (allReady || isReadyConditionTrue) return { phase, statusText: 'Running' }
      return { phase, statusText: 'NotReady' }
    }

    if (podReason) return { phase, statusText: podReason }
    return { phase, statusText: phase }
  }

  const deleteSelectedPods = useCallback(async () => {
    if (selectedPodRows.length === 0 || podBulkDeleteBusy) return
    setPodBulkDeleteBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedPodRows.map(async (row) => {
          await ResourceDelete('pods', row.namespace, row.name)
          return `${row.namespace}/${row.name}`
        }),
      )
      const deletedKeys: string[] = []
      const failedReasons: string[] = []
      results.forEach((r) => {
        if (r.status === 'fulfilled') deletedKeys.push(r.value)
        else failedReasons.push(r.reason instanceof Error ? r.reason.message : 'Delete failed')
      })
      if (deletedKeys.length > 0) {
        const deletedSet = new Set(deletedKeys)
        setItems((prev) => prev.filter((item) => !deletedSet.has(`${item.namespace}/${item.name}`)))
      }
      setSelectedPodRows([])
      setPodRowSelectionResetKey((n) => n + 1)
      if (failedReasons.length === 0) {
        uiNotify.success(`Deleted ${deletedKeys.length} pod(s)`)
      } else {
        uiNotify.error(`Deleted ${deletedKeys.length}/${selectedPodRows.length}. ${failedReasons[0]}`)
      }
    } finally {
      setPodBulkDeleteBusy(false)
    }
  }, [selectedPodRows, podBulkDeleteBusy])

  const humanAge = (timestamp: string) => {
    const compact = formatAge(timestamp)
    if (compact === '—') return compact
    return `${compact} ago`
  }



  useEffect(() => {
    let cancelled = false

    const loadPods = async () => {
      setLoading(true)
      try {
        const list = await listResourcesViaBinding('pods', selectedNamespace)

        const mapped = list.map((pod) => {
          const obj = pod as Record<string, unknown>
          const meta = (obj.metadata as Record<string, unknown> | undefined) ?? {}
          const status = (obj.status as Record<string, unknown> | undefined) ?? {}
          const spec = (obj.spec as Record<string, unknown> | undefined) ?? {}
          const statuses = Array.isArray(status.containerStatuses)
            ? (status.containerStatuses as Array<Record<string, unknown>>)
            : []
          const restarts = statuses.reduce((sum, s) => sum + Number(s.restartCount ?? 0), 0)
          const containers = Array.isArray(spec.containers)
            ? (spec.containers as Array<Record<string, unknown>>)
            : []
          const primaryContainer = String(containers[0]?.name ?? 'all')
          const podState = toPodStatus(obj)

          const conditions = Array.isArray(status.conditions)
            ? (status.conditions as Array<Record<string, unknown>>)
            : []
          const schedulingReason = statuses.length === 0 && conditions.length > 0
            ? String(conditions[0].reason ?? '')
            : undefined
          const schedulingMessage = statuses.length === 0 && conditions.length > 0
            ? String(conditions[0].message ?? '')
            : undefined

          return {
            namespace: String(meta.namespace ?? 'cluster'),
            name: String(meta.name ?? 'unknown'),
            phase: podState.phase,
            statusText: podState.statusText,
            node: String(spec.nodeName ?? 'n/a'),
            restarts,
            createdAt: String(meta.creationTimestamp ?? ''),
            primaryContainer,
            containerStatuses: statuses as unknown as PodRow['containerStatuses'],
            schedulingReason,
            schedulingMessage,
          }
        })

        if (!cancelled) {
          setItems(mapped)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'pod fetch error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadPods()
    return () => { cancelled = true }

  }, [selectedNamespace])

  useEffect(() => {
    if (loading) return

    const reload = async () => {
      try {
        const list = await listResourcesViaBinding('pods', selectedNamespace)
        const mapped = list.map((pod) => {
          const obj = pod as Record<string, unknown>
          const meta = (obj.metadata as Record<string, unknown> | undefined) ?? {}
          const status = (obj.status as Record<string, unknown> | undefined) ?? {}
          const spec = (obj.spec as Record<string, unknown> | undefined) ?? {}
          const statuses = Array.isArray(status.containerStatuses)
            ? (status.containerStatuses as Array<Record<string, unknown>>)
            : []
          const restarts = statuses.reduce((sum, s) => sum + Number(s.restartCount ?? 0), 0)
          const containers = Array.isArray(spec.containers)
            ? (spec.containers as Array<Record<string, unknown>>)
            : []
          const primaryContainer = String(containers[0]?.name ?? 'all')
          const podState = toPodStatus(obj)
          const conditions = Array.isArray(status.conditions)
            ? (status.conditions as Array<Record<string, unknown>>)
            : []
          return {
            namespace: String(meta.namespace ?? 'cluster'),
            name: String(meta.name ?? 'unknown'),
            phase: podState.phase,
            statusText: podState.statusText,
            node: String(spec.nodeName ?? 'n/a'),
            restarts,
            createdAt: String(meta.creationTimestamp ?? ''),
            primaryContainer,
            containerStatuses: statuses as unknown as PodRow['containerStatuses'],
            schedulingReason: statuses.length === 0 && conditions.length > 0 ? String(conditions[0].reason ?? '') : undefined,
            schedulingMessage: statuses.length === 0 && conditions.length > 0 ? String(conditions[0].message ?? '') : undefined,
          } as PodRow
        })
        setItems(mapped)
        setStreamError(null)
      } catch { /* ignore reload errors */ }
    }

    const off = Events.On('podsInformerChanged', () => { void reload() })
    const interval = window.setInterval(() => { void reload() }, 30000)

    return () => {
      off()
      clearInterval(interval)
      setStreamError(null)
    }

  }, [selectedNamespace, loading])

  const columns = useMemo<ColumnDef<PodRow>[]>(
    () => [
      {
        id: 'phase',
        header: 'select',
        accessorKey: 'statusText',
        size: 44,
        enableSorting: false,
        meta: {
          thClassName: 'pl-3',
          tdClassName: 'pl-3',
        },
        cell: (info) => {
          return (
            <input
              type="checkbox"
              className="w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]"
              checked={info.row.getIsSelected()}
              onChange={info.row.getToggleSelectedHandler()}
              onClick={(e) => e.stopPropagation()}
            />
          )
        },
      },
      {
        id: 'name',
        header: 'Pod',
        accessorKey: 'name',
        cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue())}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'statusText',
        size: 140,
        meta: { disableOverflowTooltip: true },
        cell: (info) => {
          const row = info.row.original
          const text = row.statusText || row.phase || 'Unknown'
          const phase = row.phase || text
          const n = text.toLowerCase()
          const isHealthy = n === 'running' || n === 'succeeded' || n === 'completed'
          const cls = isHealthy
            ? 'text-emerald-400'
            : n === 'pending' || n === 'containercreating' || n === 'podscheduled' || n === 'notready' || n === 'init'
              ? 'text-amber-400'
              : n === 'terminating'
                ? 'text-sky-400'
                : 'text-red-400'

          const phaseTooltip: Record<string, string> = {
            Running:   'The Pod has been bound to a node and at least one container is running.',
            Succeeded: 'All containers in the Pod have terminated in success, and will not be restarted.',
            Pending:   'One or more of the containers has not been set up and made ready to run.',
            Failed:    'At least one container has terminated in failure.',
            Unknown:   'For some reason the state of the Pod could not be obtained.',
            Terminating: 'The Pod is being gracefully terminated.',
          }
          const reasonTooltip: Record<string, string> = {
            CrashLoopBackOff:  'The container is repeatedly crashing and Kubernetes is backing off before restarting it.',
            OOMKilled:         'The container was killed because it exceeded its memory limit.',
            ImagePullBackOff:  'Kubernetes cannot pull the container image — check the image name, tag and registry credentials.',
            ErrImagePull:      'Failed to pull the container image from the registry.',
            ContainerCreating: 'The container is being created; volumes or init containers may still be initializing.',
            Init:              'Init containers are running before the main container can start.',
            Evicted:           'The Pod was evicted from its node, likely due to resource pressure.',
            NodeNotReady:      'The node the Pod was scheduled on became not ready.',
            Completed:         'The container ran to completion successfully.',
            NotReady:          'The Pod is running but one or more containers have not passed their readiness checks.',
            Terminating:       'The Pod is being gracefully terminated.',
            Error:             'The container exited with a non-zero exit code.',
          }

          const tooltipText = reasonTooltip[text] ?? reasonTooltip[phase] ?? phaseTooltip[phase] ?? `Phase: ${phase}`
          const showSub = !isHealthy && text !== phase && phase !== ''

          return (
            <UiTooltip content={<span className="max-w-[260px] text-[11px] leading-snug whitespace-normal block">{tooltipText}</span>}>
              <div className="flex flex-col gap-0.5 cursor-default">
                <span className={`text-sm font-medium ${cls}`}>
                  {text}
                </span>
                {showSub && (
                  <span className="text-[10px] text-muted-foreground/70 leading-tight pl-0.5 truncate max-w-[130px]" title={phase}>
                    {phase}
                  </span>
                )}
              </div>
            </UiTooltip>
          )
        },
      },
      {
        id: 'containers',
        header: 'Containers',
        size: 130,
        enableSorting: false,
        accessorFn: (row) => row.containerStatuses,
        meta: { disableOverflowTooltip: true },
        cell: (info) => {
          const cs = info.getValue() as PodRow['containerStatuses']
          const row = info.row.original

          // No container statuses yet — pod is stuck scheduling
          if (!cs || cs.length === 0) {
            if (row.schedulingMessage) {
              return (
                <div className="flex items-center gap-1.5">
                  <UiTooltip content={
                    <span className="max-w-[300px] text-[11px] leading-snug whitespace-normal block">
                      {row.name}: {row.schedulingMessage}
                    </span>
                  }>
                    <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0 bg-amber-400 cursor-default" />
                  </UiTooltip>
                  {row.schedulingReason && (
                    <span className="text-[10px] text-amber-400/80 truncate max-w-[110px]" title={row.schedulingReason}>
                      {row.schedulingReason}
                    </span>
                  )}
                </div>
              )
            }
            return <span className="text-muted-foreground text-sm">—</span>
          }

          return (
            <div className="flex items-center gap-1">
              {cs.map((c, i) => {
                const state = c.state ?? {}
                const dotCls = state.running && c.ready
                  ? 'bg-emerald-500'
                  : state.terminated && c.state?.terminated?.reason === 'Completed'
                    ? 'bg-emerald-500'
                    : state.running && !c.ready
                      ? 'bg-amber-400'
                      : state.waiting
                        ? 'bg-amber-400'
                        : 'bg-red-500'
                const tip = state.waiting
                  ? `${c.name}\nwaiting: ${c.state?.waiting?.reason ?? '—'}\nrestarts: ${c.restartCount}`
                  : state.terminated
                    ? `${c.name}\n${c.state?.terminated?.reason ?? 'terminated'}`
                    : `${c.name}: running`
                return (
                  <UiTooltip key={i} content={<span className="whitespace-pre">{tip}</span>}>
                    <span className={`w-2.5 h-2.5 rounded-full inline-block shrink-0 cursor-default ${dotCls}`} />
                  </UiTooltip>
                )
              })}

            </div>
          )
        },
      },
      {
        id: 'namespace',
        header: 'Namespace',
        accessorKey: 'namespace',
        cell: (info) => <span className="text-sm text-foreground">{String(info.getValue())}</span>,
      },
      { id: 'node', header: 'Node', accessorKey: 'node', cell: (info) => <span className="text-sm text-muted-foreground">{String(info.getValue())}</span> },
      {
        id: 'restarts',
        header: 'Restarts',
        accessorKey: 'restarts',
        cell: (info) => {
          const v = Number(info.getValue()) || 0
          const cls = v === 0
            ? 'bg-emerald-500/10 text-emerald-300'
            : v < 5
              ? 'bg-amber-500/10 text-amber-300'
              : 'bg-red-500/10 text-red-300'
          return <span className={`inline-flex min-w-8 justify-center rounded px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{v}</span>
        },
      },
      {
        id: 'age',
        header: 'Age',
        accessorFn: (row) => row.createdAt,
        sortingFn: 'datetime',
        meta: { shrink: true },
        cell: (info) => <span className="text-sm text-muted-foreground whitespace-nowrap">{humanAge(String(info.getValue() ?? ''))}</span>,
      },
    ],
    [],
  )

  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      {showCreatePodModal && (
        <CreateResourceModal
          resource='pods'
          label='Pod'
          onClose={() => setShowCreatePodModal(false)}
        />
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">Pods</h3>
          <p className="text-sm text-muted-foreground">Manage running workloads and containers.</p>
        </div>
        <button type="button" onClick={() => setShowCreatePodModal(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/20 transition-all duration-150 active:scale-[0.97]">
          <span className="flex items-center justify-center w-4 h-4 rounded bg-primary text-primary-foreground shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </span>
          New Pod
        </button>
      </div>

      {error && <p className="text-sm text-red-400">Error: {error}</p>}

      <div className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible" id="pods-toolbar">
        <div className="flex items-center gap-3 flex-wrap overflow-visible">
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label shrink-0" htmlFor="pods-namespace">Namespace</label>
            <MantineSelect
              id="pods-namespace"
              value={selectedNamespace}
              onChange={(value) => setSelectedNamespace(value ?? 'all')}
              data={namespaces.map((n) => ({ value: n, label: n === 'all' ? 'All namespaces' : n }))}
              size="xs"
              w={220}
              searchable
              allowDeselect={false}
              spellCheck={false}
              classNames={{ input: 'pods-glass-control' }}
              styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
            />
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Filter pods..."
              className="lucid-control rounded pl-7 pr-3 py-1 text-xxs min-w-[220px] focus:outline-none font-label"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {/* Status filter buttons – styled like the dashboard nodes sort buttons */}
          <div className="flex items-center gap-1 text-[10px]">
            {(['all', 'running', 'restarting', 'warning', 'error', 'terminating'] as PodStatusFilter[]).map((f) => {
              const count = statusFilterCounts[f]
              const dotCls = f === 'running' ? 'bg-emerald-500' : f === 'restarting' ? 'bg-amber-400' : f === 'warning' ? 'bg-amber-400' : f === 'error' ? 'bg-red-500' : f === 'terminating' ? 'bg-sky-400' : ''
              return (
                <UiTooltip key={f} content={`Show ${podStatusFilterLabel(f)} pods`}>
                  <button
                    onClick={() => setStatusFilter(f)}
                    className={`flex items-center gap-1 px-2 py-1 rounded font-bold uppercase tracking-wider transition-colors ${
                      statusFilter === f
                        ? 'bg-primary/20 text-primary rounded-md'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md'
                    }`}
                  >
                    {f !== 'all' && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />}
                    {podStatusFilterLabel(f)}
                    {count > 0 && f !== 'all' && <span className="opacity-60">({count})</span>}
                  </button>
                </UiTooltip>
              )
            })}
          </div>
          {selectedPodRows.length > 0 && (
            <div className="lucid-control flex items-center gap-1.5 rounded text-sm focus:outline-none px-2 py-1.5 bg-[#0f172a80]">
              <span className="text-[10px] tracking-wider text-muted-foreground max-w-[360px] truncate" title={selectedPodRows.map((r) => r.name).join(', ')}>
                Selected pods: {selectedPodRows.map((r) => r.name).join(', ')}
              </span>
              <button
                type="button"
                onClick={() => setConfirmBulkDeletePodsOpen(true)}
                disabled={podBulkDeleteBusy}
                className="px-1 py-0 rounded text-[10px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {podBulkDeleteBusy ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {loading ? 'Loading...' : statusFilter === 'all' ? `${items.length} pods` : `${filteredItems.length} / ${items.length} pods`}
        </span>
      </div>

      {streamError && !error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-sm shrink-0">
          {streamError}
        </div>
      )}

      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={filteredItems}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={38}
          emptyLabel={statusFilter !== 'all' ? `No ${podStatusFilterLabel(statusFilter).toLowerCase()} pods` : 'Loading…'}
          loading={loading || (items.length === 0 && !error)}
          columnOrder={['phase', 'name', 'status', 'containers', 'namespace', 'node', 'restarts', 'age']}
          defaultSorting={[{ id: 'name', desc: false }]}
          persistKey="pods"
          onSelectedRowsChange={setSelectedPodRows}
          rowSelectionResetKey={podRowSelectionResetKey}
          onRowClick={(row) => {
            setSelectedPodTab('overview')
            setSelectedPod(row)
          }}
        />
      </div>

      <PodActionDrawer
        pod={selectedPod}
        initialTab={selectedPodTab}
        onClose={() => setSelectedPod(null)}
      />
      <ConfirmDialog
        open={confirmBulkDeletePodsOpen}
        title={`Delete ${selectedPodRows.length} pod(s)?`}
        description={`Selected: ${selectedPodRows.map((r) => r.name).join(', ')}`}
        confirmLabel={`Delete ${selectedPodRows.length} pod(s)`}
        onConfirm={() => { setConfirmBulkDeletePodsOpen(false); void deleteSelectedPods() }}
        onCancel={() => setConfirmBulkDeletePodsOpen(false)}
      />
    </div>
  )
}

const CLUSTER_SCOPED_INFORMER_RESOURCES = new Set<string>([
  'clusterrolebindings',
  'clusterroles',
  'namespaces',
  'nodes',
  'persistentvolumes',
  'priorityclasses',
  'runtimeclasses',
  'storageclasses',
  'volumeattachments',
])

function toInformerStatus(resource: Record<string, unknown>) {
  const status = (resource.status as Record<string, unknown> | undefined) ?? {}
  const phase = String(status.phase ?? '').trim()
  if (phase) return phase

  const conditions = Array.isArray(status.conditions) ? (status.conditions as Array<Record<string, unknown>>).slice(0, 5) : []
  if (conditions.length > 0) {
    const ready = conditions.find((c) => String(c.type ?? '') === 'Ready')
    if (ready) {
      if (String(ready.status ?? '') === 'True') return 'Ready'
      return String(ready.reason ?? ready.type ?? 'NotReady')
    }
    return String(conditions[0].type ?? 'Unknown')
  }

  const reason = String(status.reason ?? '').trim()
  if (reason) return reason
  return 'Unknown'
}

function informerStatusTextClass(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'true' || normalized.includes('ready') || normalized.includes('running') || normalized.includes('active') || normalized.includes('succeeded') || normalized.includes('available') || normalized.includes('bound') || normalized.includes('completed')) {
    return 'text-emerald-400'
  }
  if (normalized === 'false' || normalized.includes('failed') || normalized.includes('error') || normalized.includes('unavailable') || normalized.includes('notready') || normalized.includes('terminated') || normalized.includes('crashloop')) {
    return 'text-red-400'
  }
  if (normalized.includes('terminating')) {
    return 'text-sky-400'
  }
  return 'text-amber-400'
}

/** Color a condition taking both its type and status into account.
 *  "Allowed/Permitted"-style conditions use amber for False (protective, not an error). */
function conditionStatusClass(type: string, status: string): string {
  const normalizedType = type.toLowerCase()
  const normalizedStatus = status.toLowerCase()
  if (normalizedType.includes('allowed') || normalizedType.includes('permitted')) {
    return normalizedStatus === 'true' ? 'text-emerald-400' : 'text-amber-400'
  }
  return informerStatusTextClass(status)
}

function renderInformerConditions(
  conditions: Array<Record<string, unknown>> | undefined,
  fallbackStatus: string,
): ReactNode {
  const rows = Array.isArray(conditions)
    ? conditions.map((condition, index) => ({
        key: `${String(condition.type ?? 'Condition')}-${index}`,
        type: String(condition.type ?? '').trim() || 'Condition',
        status: String(condition.status ?? 'Unknown'),
      }))
    : []

  if (rows.length === 0) {
    return <span className={`text-sm font-medium ${informerStatusTextClass(fallbackStatus)}`}>{fallbackStatus}</span>
  }

  return (
    <div className="space-y-0.5 leading-tight break-words">
      {rows.map((condition) => (
        <div key={condition.key} className={`text-sm font-medium ${conditionStatusClass(condition.type, condition.status)}`}>
          {condition.type}
        </div>
      ))}
    </div>
  )
}

function InformerResourcePage({ resource }: { resource: string }) {
  type Row = ResourceRow

  const isNamespaced = !CLUSTER_SCOPED_INFORMER_RESOURCES.has(resource)
  const navigationFilter = useMemo(() => readNavigationFilterFromUrl(), [])
  const urlFilterHydratedRef = useRef(false)
  const [globalFilter, setGlobalFilter] = useState(navigationFilter.query)
  const [selectedNamespace, setSelectedNamespace] = usePersistentState(`resources:${resource}:namespace`, navigationFilter.namespace || 'all')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Row[]>([])
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [rowSelectionResetKey, setRowSelectionResetKey] = useState(0)
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false)
  const [drawerRow, setDrawerRow] = useState<ResourceRef | null>(null)
  const [deploymentDrawerRow, setDeploymentDrawerRow] = useState<DeploymentRow | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  useEffect(() => {
    if (urlFilterHydratedRef.current) return
    urlFilterHydratedRef.current = true
    if (navigationFilter.namespace && navigationFilter.namespace !== selectedNamespace) {
      setSelectedNamespace(navigationFilter.namespace)
    }
    if (navigationFilter.query && navigationFilter.query !== globalFilter) {
      setGlobalFilter(navigationFilter.query)
    }
  }, [globalFilter, navigationFilter.namespace, navigationFilter.query, selectedNamespace, setSelectedNamespace])

  const { namespaces: namespaceList } = useNamespaceOptions()
  const namespaces = useMemo(() => ['all', ...namespaceList], [namespaceList])
  const effectiveNamespace = isNamespaced ? selectedNamespace : 'all'

  useEffect(() => {
    if (!isNamespaced) return
    if (!namespaces.includes(selectedNamespace)) setSelectedNamespace('all')
  }, [isNamespaced, namespaces, selectedNamespace, setSelectedNamespace])

  // Per-resource Zustand store – one slice per resource+namespace key
  const storeKey = `${resource}:${effectiveNamespace}`
  // Select the whole slice object so Zustand compares by reference (stable).
  // Fallback to module-level EMPTY_SLICE so `?? []` never creates a new ref.
  const storeSlice  = useK8sResourceStore(useCallback((s) => s.slices[storeKey], [storeKey]))
  const storeItems   = storeSlice?.items   ?? EMPTY_ROWS
  const storeLoading = storeSlice?.loading ?? false
  const storeError   = storeSlice?.error   ?? null
  const { setItems: storeSetItems, setLoading: storeSetLoading, setError: storeSetError } = useK8sResourceStore()

  const toRow = useCallback((obj: Record<string, unknown>): Row => {
    const meta = (obj.metadata as Record<string, unknown> | undefined) ?? {}
    const extra = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'metadata')) as Record<string, unknown>
    return {
      uid: String(meta.uid ?? `${String(meta.namespace ?? '_')}/${String(meta.name ?? 'unknown')}`),
      name: String(meta.name ?? 'unknown'),
      namespace: String(meta.namespace ?? 'cluster'),
      kind: String(obj.kind ?? 'Unknown'),
      status: toInformerStatus(obj),
      createdAt: String(meta.creationTimestamp ?? ''),
      extra,
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      storeSetLoading(storeKey, true)
      try {
        const list = await listResourcesViaBinding(resource, effectiveNamespace)
        if (!cancelled) storeSetItems(storeKey, list.map((e) => toRow(e as Record<string, unknown>)))
      } catch (err) {
        if (!cancelled) storeSetError(storeKey, err instanceof Error ? err.message : 'fetch error')
      }
    }
    void load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, effectiveNamespace])

  useEffect(() => {
    if (storeLoading) return
    const reload = async () => {
      try {
        const list = await listResourcesViaBinding(resource, effectiveNamespace)
        storeSetItems(storeKey, list.map((e) => toRow(e as Record<string, unknown>)))
        setStreamError(null)
      } catch { /* ignore */ }
    }
    const off = Events.On(`${resource}InformerChanged`, () => { void reload() })
    const interval = window.setInterval(() => { void reload() }, 30000)
    return () => { off(); clearInterval(interval); setStreamError(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, effectiveNamespace, storeLoading])

  const deleteBulk = useCallback(async () => {
    if (selectedRows.length === 0 || bulkDeleteBusy) return
    setBulkDeleteBusy(true)
    try {
      const results = await Promise.allSettled(selectedRows.map(async (row) => { await ResourceDelete(resource, row.namespace, row.name); return row.uid }))
      const deletedUids: string[] = []; const failedReasons: string[] = []
      results.forEach((r) => { if (r.status === 'fulfilled') deletedUids.push(r.value); else failedReasons.push(r.reason instanceof Error ? r.reason.message : 'Delete failed') })
      if (deletedUids.length > 0) { const s = new Set(deletedUids); storeSetItems(storeKey, storeItems.filter((item) => !s.has(item.uid))) }
      setSelectedRows([]); setRowSelectionResetKey((n) => n + 1)
      if (failedReasons.length === 0) uiNotify.success(`Deleted ${deletedUids.length} ${resource}`)
      else uiNotify.error(`Deleted ${deletedUids.length}/${selectedRows.length}. ${failedReasons[0]}`)
    } finally { setBulkDeleteBusy(false) }
  }, [selectedRows, bulkDeleteBusy, resource, storeKey, storeItems, storeSetItems])

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const xs = (v: unknown) => <span className="text-sm text-muted-foreground">{String(v ?? '—')}</span>
    const ex = (row: Row, key: string) => row.extra[key]
    const exSpec = (row: Row, key: string) => (row.extra.spec as Record<string, unknown> | undefined)?.[key]
    const exStatus = (row: Row, key: string) => (row.extra.status as Record<string, unknown> | undefined)?.[key]

    const selectCol: ColumnDef<Row> = { id: 'select', header: 'select', accessorKey: 'name', enableSorting: false, enableGlobalFilter: false, size: 44, meta: { thClassName: 'pl-3', tdClassName: 'pl-3' }, cell: (info) => (<input type="checkbox" className="w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]" checked={info.row.getIsSelected()} onChange={info.row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />) }
    const nameCol: ColumnDef<Row> = { id: 'name', header: 'Name', accessorKey: 'name', cell: (info) => <span className="font-label text-sm text-foreground font-semibold">{String(info.getValue())}</span> }
    const nsCol: ColumnDef<Row> = { id: 'namespace', header: 'Namespace', accessorKey: 'namespace', cell: (info) => xs(info.getValue()) }
    const ageCol: ColumnDef<Row> = { id: 'age', header: 'Age', accessorFn: (row) => row.createdAt, sortingFn: 'datetime', meta: { shrink: true }, cell: (info) => <span className="text-sm text-muted-foreground whitespace-nowrap">{humanAge(String(info.getValue() ?? ''))}</span> }
    const statusCol: ColumnDef<Row> = {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      size: 180,
      meta: { disableOverflowTooltip: true, allowWrap: true, tdClassName: 'align-top' },
      cell: (info) => {
        const row = info.row.original
        const statusObject = row.extra.status as Record<string, unknown> | undefined
        const conditions = Array.isArray(statusObject?.conditions)
          ? (statusObject.conditions as Array<Record<string, unknown>>)
          : undefined
        return renderInformerConditions(conditions, String(info.getValue() ?? 'Unknown'))
      },
    }
    const NO_STATUS = new Set(['configmaps','secrets','serviceaccounts','roles','rolebindings','clusterroles','clusterrolebindings','endpoints','limitranges','resourcequotas','runtimeclasses','storageclasses','priorityclasses','events','networkpolicies','daemonsets','statefulsets','replicasets','cronjobs','services','ingresses','volumeattachments','poddisruptionbudgets'])

    const resourceCols: Record<string, ColumnDef<Row>[]> = {
      pods: [
        { id: 'phase', header: 'Phase', size: 90, accessorFn: (r) => exStatus(r,'phase') ?? 'Unknown', cell: (i) => { const p=String(i.getValue()??'Unknown'); const cls=p==='Running'?'text-emerald-400':p==='Pending'?'text-amber-400':p==='Succeeded'?'text-blue-400':'text-red-400'; return <span className={`text-sm font-semibold ${cls}`}>{p}</span> } },
        { id: 'ready', header: 'Ready', size: 75, accessorFn: (r) => { const cs=(exStatus(r,'containerStatuses') as Array<{ready:boolean}>|undefined)??[]; return `${cs.filter(c=>c.ready).length}/${cs.length}` }, cell: (i) => xs(i.getValue()) },
        { id: 'node', header: 'Node', accessorFn: (r) => exSpec(r,'nodeName') ?? '—', cell: (i) => <span className="text-sm text-muted-foreground truncate max-w-[150px] block" title={String(i.getValue())}>{String(i.getValue())}</span> },
      ],
      deployments: [
        { id: 'replicas', header: 'Replicas', size: 100, accessorFn: (r) => exStatus(r,'readyReplicas')??0, cell: (i) => { const r=i.row.original; const ready=Number(exStatus(r,'readyReplicas')??0); const desired=Number(exSpec(r,'replicas')??0); return ratioBadge(ready, desired) } },
      ],
      statefulsets: [
        { id: 'pods', header: 'Pods', size: 90, accessorFn: (r) => exStatus(r,'availableReplicas')??0, cell: (i) => { const r=i.row.original; const avail=Number(exStatus(r,'availableReplicas')??0); const total=Number(exStatus(r,'replicas')??0); const ok=avail>=total&&total>0; return <span className={`text-sm font-semibold ${ok?'text-emerald-400':(avail>0?'text-amber-400':'text-red-400')}`}>{avail}/{total}</span> } },
        { id: 'replicas', header: 'Replicas', size: 80, accessorFn: (r) => exSpec(r,'replicas')??0, cell: (i) => xs(i.getValue()??0) },
      ],
      daemonsets: [
        { id: 'daemons', header: 'Daemons', size: 100, meta: { disableOverflowTooltip: true }, accessorFn: (r) => `${String(exStatus(r,'numberReady')??0)}/${String(exStatus(r,'desiredNumberScheduled')??0)}`, cell: (i) => ratioBadge(i.getValue<string>()) },
        { id: 'nodes', header: 'Nodes', size: 75, accessorFn: (r) => exStatus(r,'currentNumberScheduled')??0, cell: (i) => xs(i.getValue()??0) },
      ],
      replicasets: [{ id: 'replicas', header: 'Replicas', size: 100, accessorFn: (r) => exStatus(r,'readyReplicas')??0, cell: (i) => { const r=i.row.original; return xs(`${String(exStatus(r,'readyReplicas')??0)}/${String(exSpec(r,'replicas')??0)}`) } }],
      replicationcontrollers: [{ id: 'replicas', header: 'Replicas', size: 100, accessorFn: (r) => exStatus(r,'readyReplicas')??0, cell: (i) => { const r=i.row.original; const ready=Number(exStatus(r,'readyReplicas')??0); const desired=Number(exSpec(r,'replicas')??0); return ratioBadge(ready, desired) } }],
      cronjobs: [
        { id: 'schedule', header: 'Schedule', meta: { disableOverflowTooltip: true }, accessorFn: (r) => exSpec(r,'schedule'), cell: (i) => { const schedule = String(i.getValue() ?? '—'); let human = ''; try { human = cronstrue.toString(schedule, { use24HourTimeFormat: true, verbose: true }) } catch { /**/ } const inner = <span className="font-mono text-sm text-muted-foreground">{schedule}</span>; return human ? <FixedTooltipInline content={human}>{inner}</FixedTooltipInline> : inner } },
        { id: 'active', header: 'Active', size: 75, accessorFn: (r) => (exStatus(r,'active') as unknown[]|undefined)?.length??0, cell: (i) => xs(i.getValue()??0) },
        { id: 'suspend', header: 'Suspended', size: 90, accessorFn: (r) => exSpec(r,'suspend'), cell: (i) => <span className={`text-sm ${i.getValue()?'text-amber-400':'text-muted-foreground'}`}>{i.getValue()?'Yes':'No'}</span> },
      ],
      jobs: [
        { id: 'running', header: 'Running', size: 80, accessorFn: (r) => exStatus(r,'active')??0, cell: (i) => xs(i.getValue()??0) },
        { id: 'succeeded', header: 'Succeeded', size: 110, accessorFn: (r) => exStatus(r,'succeeded')??0, cell: (i) => { const r=i.row.original; return xs(`${String(exStatus(r,'succeeded')??0)}/${String(exSpec(r,'completions')??'—')}`) } },
        { id: 'failed', header: 'Failed', size: 70, accessorFn: (r) => exStatus(r,'failed')??0, cell: (i) => { const v=Number(i.getValue()??0); return <span className={`text-sm ${v>0?'text-red-400':'text-muted-foreground'}`}>{v}</span> } },
        { id: 'suspend', header: 'Suspended', size: 90, accessorFn: (r) => exSpec(r,'suspend'), cell: (i) => <span className={`text-sm ${i.getValue()?'text-amber-400':'text-muted-foreground'}`}>{i.getValue()?'Yes':'No'}</span> },
      ],
      horizontalpodautoscalers: [
        { id: 'metrics', header: 'Metrics', accessorFn: (r) => { const cm=exStatus(r,'currentMetrics') as Array<Record<string,unknown>>|undefined; if (!cm?.length) return '—'; const m=cm[0]; if (String(m.type)==='Resource') { const res=m.resource as Record<string,unknown>|undefined; const cur=(res?.current as Record<string,unknown>|undefined)?.averageUtilization; const tgt=(exSpec(r,'metrics') as Array<Record<string,unknown>>|undefined)?.[0]; const tgtPct=(tgt?.resource as Record<string,unknown>|undefined)?.target; const tgtVal=(tgtPct as Record<string,unknown>|undefined)?.averageUtilization; const name=(res?.name??'cpu'); return `${cur??'?'}%/${tgtVal??'?'}% (${name})`; } return String(m.type??'—') } },
        { id: 'minMax', header: 'Min/Max Pods', size: 110, accessorFn: (r) => exSpec(r,'minReplicas'), cell: (i) => { const r=i.row.original; return xs(`${String(exSpec(r,'minReplicas')??'—')}/${String(exSpec(r,'maxReplicas')??'—')}`) } },
        { id: 'replicas', header: 'Replicas', size: 90, accessorFn: (r) => exStatus(r,'currentReplicas')??0, cell: (i) => { const r=i.row.original; const cur=Number(exStatus(r,'currentReplicas')??0); const des=Number(exStatus(r,'desiredReplicas')??0); return ratioBadge(cur, des) } },
      ],
      services: [
        { id: 'ports', header: 'Ports', accessorFn: (r) => exSpec(r,'ports'), enableSorting: false, cell: (i) => { const ports=i.getValue() as Array<Record<string,unknown>>|undefined; if (!ports?.length) return xs('—'); return <span className="text-sm text-muted-foreground">{ports.map((p)=>`${p.port}${p.targetPort?'→'+p.targetPort:''}/${p.protocol??'TCP'}`).join(', ')}</span> } },
        { id: 'type', header: 'Type', size: 100, accessorFn: (r) => exSpec(r,'type'), cell: (i) => xs(i.getValue()) },
        { id: 'clusterIP', header: 'ClusterIP', size: 130, accessorFn: (r) => exSpec(r,'clusterIP'), cell: (i) => <span className="font-mono text-sm text-muted-foreground">{String(i.getValue()??'—')}</span> },
        { id: 'externalIP', header: 'ExternalIP', accessorFn: (r) => { const ips=exSpec(r,'externalIPs') as string[]|undefined; const lb=exStatus(r,'loadBalancer') as Record<string,unknown>|undefined; const ing=(lb?.ingress as Array<Record<string,unknown>>|undefined)?.[0]; return ips?.[0]??(ing?.ip as string)??(ing?.hostname as string)??'—' }, cell: (i) => xs(i.getValue()) },
      ],
      ingresses: [
        { id: 'lb', header: 'LoadBalancers', accessorFn: (r) => { const lbIng=(exStatus(r,'loadBalancer') as Record<string,unknown>|undefined)?.ingress as Array<{ip?:string;hostname?:string}>|undefined; return lbIng?.map(i=>i.ip??i.hostname).filter(Boolean).join(', ')||'—' }, cell: (i) => xs(i.getValue()) },
        { id: 'hosts', header: 'Rules', accessorFn: (r) => (exSpec(r,'rules') as Array<{host?:string}>|undefined)?.map(r=>r.host??'*').join(', ')??'—', cell: (i) => <span className="text-sm text-muted-foreground truncate max-w-[280px] block" title={String(i.getValue())}>{String(i.getValue()??'—')}</span> },
      ],
      networkpolicies: [{ id: 'policyTypes', header: 'Policy Types', accessorFn: (r) => (exSpec(r,'policyTypes') as string[]|undefined)?.join(', ')??'—', cell: (i) => xs(i.getValue()) }],
      persistentvolumeclaims: [
        { id: 'storageClass', header: 'Storage Class', accessorFn: (r) => exSpec(r,'storageClassName'), cell: (i) => xs(i.getValue()) },
        { id: 'size', header: 'Size', size: 90, accessorFn: (r) => { const res=exSpec(r,'resources') as Record<string,unknown>|undefined; return (res?.requests as Record<string,unknown>|undefined)?.storage }, cell: (i) => xs(i.getValue()) },
        { id: 'volume', header: 'Volume', accessorFn: (r) => exSpec(r,'volumeName'), cell: (i) => xs(i.getValue()) },
      ],
      persistentvolumes: [
        { id: 'storageClass', header: 'Storage Class', accessorFn: (r) => exSpec(r,'storageClassName'), cell: (i) => xs(i.getValue()) },
        { id: 'mode', header: 'Vol Mode', size: 90, accessorFn: (r) => exSpec(r,'volumeMode')??'—', cell: (i) => xs(i.getValue()) },
        { id: 'size', header: 'Size', size: 90, accessorFn: (r) => (exSpec(r,'capacity') as Record<string,unknown>|undefined)?.storage, cell: (i) => xs(i.getValue()) },
        { id: 'accessModes', header: 'Access Modes', accessorFn: (r) => (exSpec(r,'accessModes') as string[]|undefined)?.join(', ')??'—', cell: (i) => xs(i.getValue()) },
        { id: 'reclaimPolicy', header: 'Reclaim Policy', size: 130, accessorFn: (r) => exSpec(r,'persistentVolumeReclaimPolicy'), cell: (i) => xs(i.getValue()) },
      ],
      storageclasses: [
        { id: 'provisioner', header: 'Provisioner', accessorFn: (r) => ex(r,'provisioner'), cell: (i) => xs(i.getValue()) },
        { id: 'reclaimPolicy', header: 'Reclaim Policy', size: 130, accessorFn: (r) => ex(r,'reclaimPolicy'), cell: (i) => xs(i.getValue()) },
        { id: 'volumeBindingMode', header: 'Binding Mode', accessorFn: (r) => ex(r,'volumeBindingMode'), cell: (i) => xs(i.getValue()) },
      ],
      volumeattachments: [
        { id: 'attacher', header: 'Attacher', accessorFn: (r) => exSpec(r,'attacher'), cell: (i) => xs(i.getValue()) },
        { id: 'pvname', header: 'PV', accessorFn: (r) => (exSpec(r,'source') as Record<string,unknown>|undefined)?.persistentVolumeName, cell: (i) => xs(i.getValue()) },
        { id: 'node', header: 'Node', size: 160, accessorFn: (r) => exSpec(r,'nodeName'), cell: (i) => xs(i.getValue()) },
      ],
      secrets: [
        { id: 'type', header: 'Type', size: 120, accessorFn: (r) => ex(r,'type'), cell: (i) => xs(i.getValue()) },
        { id: 'keys', header: 'Keys', accessorFn: (r) => Object.keys((ex(r,'data') as Record<string,unknown>|undefined)??{}).join(', ')||'—', cell: (i) => { const v=String(i.getValue()??'—'); return <span className="text-sm text-muted-foreground truncate max-w-[200px] block" title={v}>{v}</span> } },
      ],
      configmaps: [{ id: 'keys', header: 'Keys', accessorFn: (r) => Object.keys((ex(r,'data') as Record<string,unknown>|undefined)??{}).join(', ')||'—', cell: (i) => { const v=String(i.getValue()??'—'); return <span className="text-sm text-muted-foreground truncate max-w-[260px] block" title={v}>{v}</span> } }],
      rolebindings: [
        { id: 'roleRef', header: 'Role', accessorFn: (r) => { const rr=ex(r,'roleRef') as {kind?:string;name?:string}|undefined; return rr?`${rr.kind??''}/${rr.name??''}`:'—' }, cell: (i) => xs(i.getValue()) },
        { id: 'subjects', header: 'Subjects', size: 80, accessorFn: (r) => (ex(r,'subjects') as unknown[]|undefined)?.length??0, cell: (i) => xs(i.getValue()) },
      ],
      clusterrolebindings: [
        { id: 'roleRef', header: 'Role', accessorFn: (r) => { const rr=ex(r,'roleRef') as {kind?:string;name?:string}|undefined; return rr?`${rr.kind??''}/${rr.name??''}`:'—' }, cell: (i) => xs(i.getValue()) },
        { id: 'subjects', header: 'Subjects', size: 80, accessorFn: (r) => (ex(r,'subjects') as unknown[]|undefined)?.length??0, cell: (i) => xs(i.getValue()) },
      ],
      priorityclasses: [
        { id: 'value', header: 'Value', size: 90, accessorFn: (r) => ex(r,'value'), cell: (i) => xs(i.getValue()) },
        { id: 'preemption', header: 'Preemption Policy', accessorFn: (r) => ex(r,'preemptionPolicy'), cell: (i) => xs(i.getValue()) },
      ],
      runtimeclasses: [{ id: 'handler', header: 'Handler', accessorFn: (r) => ex(r,'handler'), cell: (i) => xs(i.getValue()) }],
      endpoints: [{ id: 'subsets', header: 'Endpoints', accessorFn: (r) => { const ss=ex(r,'subsets') as Array<{addresses?:Array<{ip:string}>;ports?:Array<{port:number;protocol?:string}>}>|undefined; if (!ss?.length) return '—'; const eps=ss.flatMap((s)=>(s.addresses??[]).flatMap((a)=>(s.ports??[]).map((p)=>`${a.ip}:${p.port}`))); return eps.slice(0,6).join(', ')+(eps.length>6?` +${eps.length-6} more`:'') }, cell: (i) => { const v=String(i.getValue()??'—'); return <span className="text-sm text-muted-foreground">{v}</span> } }],
      events: [
        { id: 'lastSeen', header: 'Last Seen', accessorFn: (r) => ex(r,'lastTimestamp')??ex(r,'eventTime'), sortingFn: 'datetime', cell: (i) => <span className="text-sm text-muted-foreground whitespace-nowrap">{humanAge(String(i.getValue()??''))}</span> },
        { id: 'object', header: 'Object', accessorFn: (r) => { const o=ex(r,'involvedObject') as {kind?:string;name?:string}|undefined; return o?`${o.kind??''}/${o.name??''}`:'—' }, cell: (i) => <span className="text-sm text-muted-foreground">{String(i.getValue())}</span> },
        { id: 'evType', header: 'Type', size: 80, accessorFn: (r) => ex(r,'type'), cell: (i) => eventTypeBadge(String(i.getValue()??'') || '—') },
        { id: 'reason', header: 'Reason', size: 130, accessorFn: (r) => ex(r,'reason'), cell: (i) => xs(i.getValue()) },
        { id: 'message', header: 'Message', accessorFn: (r) => ex(r,'message'), cell: (i) => { const v=String(i.getValue()??'—'); return <span className="text-sm text-muted-foreground">{v}</span> } },
        { id: 'count', header: 'Count', size: 70, accessorFn: (r) => ex(r,'count')??1, cell: (i) => xs(i.getValue()) },
      ],
    }
    const extra = resourceCols[resource] ?? []
    const cols: ColumnDef<Row>[] = [selectCol, nameCol]
    if (isNamespaced) cols.push(nsCol)
    cols.push(...extra)
    if (!NO_STATUS.has(resource) && resource !== 'events') cols.push(statusCol)
    cols.push(ageCol)
    return cols

  }, [isNamespaced, resource])

  const extraOrderMap: Record<string, string[]> = {
    pods: ['phase', 'ready', 'node'],
    cronjobs: ['schedule', 'active', 'suspend'],
    daemonsets: ['daemons', 'nodes'],
    deployments: ['replicas'],
    replicasets: ['replicas'],
    replicationcontrollers: ['replicas'],
    statefulsets: ['pods', 'replicas'],
    jobs: ['running', 'succeeded', 'failed', 'suspend'],
    horizontalpodautoscalers: ['metrics', 'minMax', 'replicas'],
    ingresses: ['lb', 'hosts'],
    services: ['ports', 'type', 'clusterIP', 'externalIP'],
    persistentvolumeclaims: ['storageClass', 'size', 'volume'],
    persistentvolumes: ['storageClass', 'mode', 'size', 'accessModes', 'reclaimPolicy'],
    storageclasses: ['provisioner', 'reclaimPolicy', 'volumeBindingMode'],
    volumeattachments: ['attacher', 'pvname', 'node'],
    secrets: ['type', 'keys'],
    configmaps: ['keys'],
    networkpolicies: ['policyTypes'],
    poddisruptionbudgets: ['disruptionAllowed'],
    rolebindings: ['roleRef', 'subjects'],
    clusterrolebindings: ['roleRef', 'subjects'],
    priorityclasses: ['value', 'preemption'],
    runtimeclasses: ['handler'],
    endpoints: ['subsets'],
    events: ['lastSeen', 'object', 'evType', 'reason', 'message', 'count'],
  }
  const NO_STATUS_SET = new Set(['configmaps','secrets','serviceaccounts','roles','rolebindings','clusterroles','clusterrolebindings','endpoints','limitranges','resourcequotas','runtimeclasses','storageclasses','priorityclasses','events','networkpolicies','daemonsets','statefulsets','replicasets','cronjobs','services','ingresses','volumeattachments','poddisruptionbudgets'])
  const baseOrder = isNamespaced ? ['select', 'name', 'namespace'] : ['select', 'name']
  const extraCols = extraOrderMap[resource] ?? []
  const showStatus = !NO_STATUS_SET.has(resource) && resource !== 'events'
  const columnOrder = [...baseOrder, ...extraCols, ...(showStatus ? ['status'] : []), 'age']

  const label = getInformerResourceLabel(resource) ?? resource
  const selectedNames = selectedRows.map((r) => r.name).join(', ')

  return (
    <div className="flex-1 min-h-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      {showCreateModal && (
        <CreateResourceModal
          resource={resource}
          label={label}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            // trigger a reload via the informer event pattern
            void listResourcesViaBinding(resource, effectiveNamespace).then((list) => {
              storeSetItems(storeKey, list.map((e) => toRow(e as Record<string, unknown>)))
            }).catch(() => { /* ignore */ })
          }}
        />
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">{label}</h3>
          <p className="text-sm text-muted-foreground">Manage {label.toLowerCase()} resources.</p>
        </div>
        {RESOURCE_YAML_TEMPLATES[resource] != null && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/20 transition-all duration-150 active:scale-[0.97]"
          >
            <span className="flex items-center justify-center w-4 h-4 rounded bg-primary text-primary-foreground shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </span>
            New {label}
          </button>
        )}
      </div>
      {storeError && <p className="text-sm text-red-400">Error: {storeError}</p>}
      {streamError && !storeError && (
        <div className="px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-sm shrink-0">
          {streamError}
        </div>
      )}
      <div className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible">
        <div className="flex items-center gap-3 flex-wrap overflow-visible">
          {isNamespaced && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label shrink-0" htmlFor={`${resource}-namespace`}>Namespace</label>
              <MantineSelect
                id={`${resource}-namespace`}
                value={selectedNamespace}
                onChange={(value) => setSelectedNamespace(value ?? 'all')}
                data={namespaces.map((n) => ({ value: n, label: n === 'all' ? 'All namespaces' : n }))}
                size="xs"
                w={220}
                searchable
                allowDeselect={false}
                spellCheck={false}
                classNames={{ input: 'pods-glass-control' }}
                styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
              />
            </div>
          )}
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={`Filter ${label.toLowerCase()}...`}
              className="lucid-control rounded pl-7 pr-3 py-1 text-xxs min-w-[220px] focus:outline-none font-label"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {selectedRows.length > 0 && (
            <div className="lucid-control flex items-center gap-1.5 rounded text-sm focus:outline-none px-2 py-1.5 bg-[#0f172a80]">
              <span className="text-[10px] tracking-wider text-muted-foreground max-w-[360px] truncate" title={selectedNames}>Selected: {selectedNames}</span>
              <button type="button" onClick={() => setConfirmBulkDeleteOpen(true)} disabled={bulkDeleteBusy} className="px-1 py-0 rounded text-[10px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50">{bulkDeleteBusy ? 'Deleting…' : 'Delete all'}</button>
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{storeLoading ? 'Loading...' : `${storeItems.length} ${label.toLowerCase()}`}</span>
      </div>
      <div className="lucid-surface rounded-lg overflow-hidden flex-1 min-h-0">
        <DataTable
          data={storeItems}
          columns={columns}
          globalFilter={globalFilter}
          estimateSize={38}
          emptyLabel={`No ${label.toLowerCase()} found.`}
          loading={storeLoading}
          columnOrder={columnOrder}
          defaultSorting={resource === 'events' ? [{ id: 'lastSeen', desc: true }] : [{ id: 'name', desc: false }]}
          persistKey={`informer-${resource}`}
          onSelectedRowsChange={setSelectedRows}
          rowSelectionResetKey={rowSelectionResetKey}
          onRowClick={(row) => {
            if (resource === 'deployments') {
              const spec = row.extra.spec as Record<string, unknown> | undefined
              const status = row.extra.status as Record<string, unknown> | undefined
              setDeploymentDrawerRow({
                namespace: row.namespace,
                name: row.name,
                ready: Number(status?.readyReplicas ?? 0),
                desired: Number(spec?.replicas ?? 0),
                upToDate: Number(status?.updatedReplicas ?? 0),
                available: Number(status?.availableReplicas ?? 0),
                createdAt: row.createdAt,
              })
            } else {
              setDrawerRow({ uid: row.uid, name: row.name, namespace: row.namespace, kind: row.kind })
            }
          }}
        />
      </div>
      <ResourceDrawer
        resource={drawerRow}
        resourceType={resource}
        onClose={() => setDrawerRow(null)}
      />
      <DeploymentActionDrawer
        deployment={deploymentDrawerRow}
        onClose={() => setDeploymentDrawerRow(null)}
        onDeleted={() => setDeploymentDrawerRow(null)}
      />
      <ConfirmDialog
        open={confirmBulkDeleteOpen}
        title={`Delete ${selectedRows.length} ${label.toLowerCase()}?`}
        description={`Selected: ${selectedNames}`}
        confirmLabel={`Delete ${selectedRows.length} ${label.toLowerCase()}`}
        onConfirm={() => { setConfirmBulkDeleteOpen(false); void deleteBulk() }}
        onCancel={() => setConfirmBulkDeleteOpen(false)}
      />
    </div>
  )
}
export default App
