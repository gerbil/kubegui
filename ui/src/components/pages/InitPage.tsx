import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloudUpload, FileText, User, CheckCircle2, Loader2, Server, FolderOpen, Network, Wifi, Database, Zap, X } from 'lucide-react'
import { ContextCardsSkeleton } from '../ui/Skeleton'
import {
  AppGetVersion,
  DBGetClusterConfigs,
  DBGetActiveClusterConfig,
  DBMakeClusterConfigActive,
  DBDisconnectClusterConfig,
  DBRenameClusterConfig,
  DBDeleteClusterConfig,
  AppConfigPickClusterIcon,
} from '../../../bindings/kubegui/services/backend'
import type { Clusterconfig } from '../../../bindings/kubegui/internal/db'
import { Events } from '@wailsio/runtime'
import defaultClusterIcon from '../../assets/icons/cluster.svg'

const PRODUCT_VERSION_FALLBACK = '2.0.0'

type ClusterConfig = Partial<Clusterconfig> & {
  contextName?: string
  context?: string
  cluster?: string
  Cluster?: string
  user?: string
  User?: string
  fileName?: string
  active?: number | boolean | string
  source?: string
  Source?: string
  imagePath?: string
  ImagePath?: string
}

const AUTO_DETECTED_SOURCE = 'auto-detected'

interface InitPageProps {
  onContextSelected?: (context: string) => void
  hideHeader?: boolean
}

type InitPageContextMenuState = {
  config: ClusterConfig
  x: number
  y: number
}

function hasWailsBridge(): boolean {
  return typeof window !== 'undefined' && ('__wails' in window || '_wails' in window)
}

function isActiveValue(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true'
}

function getContextName(cfg: ClusterConfig): string {
  return cfg.contextName || cfg.ContextName || ''
}

function getClusterName(cfg: ClusterConfig): string {
  return cfg.cluster || cfg.Cluster || cfg.fileName || cfg.FileName || ''
}

function getUserName(cfg: ClusterConfig): string {
  return cfg.user || cfg.User || ''
}

function getConfigContext(cfg: ClusterConfig): string {
  return cfg.context || cfg.Context || getContextName(cfg)
}

function getConfigFileName(cfg: ClusterConfig): string {
  return cfg.fileName || cfg.FileName || ''
}


function getConfigSource(cfg: ClusterConfig): string {
  return String(cfg.source || cfg.Source || '').toLowerCase()
}

function sameConfig(a: ClusterConfig, b: ClusterConfig): boolean {
  const aCtx = getConfigContext(a)
  const bCtx = getConfigContext(b)
  const aFile = getConfigFileName(a)
  const bFile = getConfigFileName(b)
  if (aCtx && bCtx && aFile && bFile) return aCtx === bCtx && aFile === bFile
  return getContextName(a) === getContextName(b)
}

function getResolvedIconPath(cfg: ClusterConfig): string {
  const raw = String(cfg.imagePath || cfg.ImagePath || '').trim()
  if (!raw) return defaultClusterIcon
  if (raw.includes('cluster.svg')) return defaultClusterIcon
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:') || raw.startsWith('blob:')) return raw
  const fileName = raw.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  if (!fileName) return defaultClusterIcon
  return `/local-images/${encodeURIComponent(fileName)}`
}

type InformerStage = 'connecting' | 'discovering' | 'discovered' | 'started' | 'synced' | 'error'

interface InformerProgress {
  stage: InformerStage
  message: string
  resourceCount?: number
}

export function InitPage({ onContextSelected, hideHeader = false }: InitPageProps) {
  const [configs, setConfigs] = useState<ClusterConfig[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(true)
  const [selectedConfig, setSelectedConfig] = useState<ClusterConfig | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [logoSrc, setLogoSrc] = useState<string | null>('/build/appicon.png')
  const [productVersion, setProductVersion] = useState(PRODUCT_VERSION_FALLBACK)
  const [syncProgress, setSyncProgress] = useState<InformerProgress | null>(null)
  const [menuState, setMenuState] = useState<InitPageContextMenuState | null>(null)
  const [configErrors, setConfigErrors] = useState<Record<string, string>>({})
  const navigatedRef = useRef(false)
  const offProgressRef = useRef<(() => void) | null>(null)

  // Ensure configErrors is referenced for static analysis
  useEffect(() => {
    void Object.keys(configErrors).length
  }, [configErrors])

  useEffect(() => {
    if (!hasWailsBridge()) return
    AppGetVersion()
      .then((version) => {
        const normalized = String(version ?? '').trim()
        if (normalized) setProductVersion(normalized)
      })
      .catch(() => {
        setProductVersion(PRODUCT_VERSION_FALLBACK)
      })
  }, [])

  const fetchConfigs = useCallback(async () => {
    setLoadingConfigs(true)
    try {
      let list: ClusterConfig[] = []
      let activeCfg: ClusterConfig | null = null

      if (hasWailsBridge()) {
        list = await DBGetClusterConfigs()

        console.debug('InitPage.fetchConfigs: got cluster configs', list)
        try {
          activeCfg = await DBGetActiveClusterConfig()
        } catch {
          activeCfg = null
        }
      }

      setConfigs(list)
      const active = activeCfg
        ? list.find((c) => sameConfig(c, activeCfg))
        : list.find((c) => isActiveValue(c.active) || isActiveValue(c.Active))
      setSelectedConfig(active ?? list[0] ?? null)
    } catch (error) {

      console.error('InitPage.fetchConfigs failed', error)
      setConfigs([])
    } finally {
      setLoadingConfigs(false)
    }
  }, [])

  useEffect(() => {
    void fetchConfigs()
  }, [fetchConfigs])

  useEffect(() => {
    const off = Events.On('clusterConfigsChanged', (ev: unknown) => {
      console.debug('InitPage: clusterConfigsChanged received', ev)
      void fetchConfigs()
    })
    return () => { off?.() }
  }, [fetchConfigs])

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

  const filteredConfigs = configs.filter(cfg => {
    const q = searchQuery.toLowerCase()
    return !q ||
      getContextName(cfg).toLowerCase().includes(q) ||
      getClusterName(cfg).toLowerCase().includes(q)
  })

  const autoDetectedConfigs = configs.filter((cfg) => getConfigSource(cfg) === AUTO_DETECTED_SOURCE)

  const handleCancelConnect = async () => {
    offProgressRef.current?.()
    offProgressRef.current = null
    navigatedRef.current = false
    setSyncProgress(null)
    setIsLoading(false)
    setConnectError(null)
    try {
      await DBDisconnectClusterConfig()
    } catch {
      // ignore
    }
  }

  const handleConnect = async () => {
    if (!selectedConfig) return
    setConnectError(null)
    setIsLoading(true)
    navigatedRef.current = false
    setSyncProgress({ stage: 'connecting', message: 'Connecting to cluster…' })

    const doNavigate = () => {
      if (navigatedRef.current) return
      navigatedRef.current = true
      offProgressRef.current = null
      setSyncProgress(null)
      onContextSelected?.(getContextName(selectedConfig) || getClusterName(selectedConfig))
    }

    const targetCfg = selectedConfig
    const offProgress = Events.On('informerProgress', (ev: unknown) => {
      const payload = (ev as { data?: { stage?: string; message?: string; resourceCount?: number } })?.data
      if (!payload?.stage) return
      setSyncProgress({ stage: payload.stage as InformerStage, message: payload.message ?? '', resourceCount: payload.resourceCount })
      if (payload.stage === 'synced') {
        offProgress?.()
        offProgressRef.current = null
        doNavigate()
      }
      if (payload.stage === 'error') {
        offProgress?.()
        offProgressRef.current = null
        void (async () => {
          try { await DBDisconnectClusterConfig() } catch { /* ignore */ }
        })()
        if (targetCfg) {
          const key = `${getConfigFileName(targetCfg)}|${getConfigContext(targetCfg)}`
          setConfigErrors((prev) => ({ ...prev, [key]: payload.message ?? 'informer error' }))
        }
        setConnectError(payload.message ?? 'Informer error')
        setSyncProgress(null)
      }
    })
    offProgressRef.current = offProgress

    try {
      const context = getConfigContext(selectedConfig)
      const fileName = getConfigFileName(selectedConfig)
      if (context && fileName) {
        await DBMakeClusterConfigActive(context, fileName)
      }
    } catch (err) {
      offProgress?.()
      const message = err instanceof Error ? err.message : 'Unable to connect'
      setConnectError(message)
      setSyncProgress(null)
    } finally {
      setIsLoading(false)
    }
  }

  const handleMenuAction = useCallback(async (action: 'connect' | 'disconnect' | 'rename' | 'icon' | 'delete') => {
    const state = menuState
    if (!state) return
    setMenuState(null)
    const config = state.config
    try {
      if (action === 'connect') {
        const context = getConfigContext(config)
        const fileName = getConfigFileName(config)
        if (context && fileName) {
          await DBMakeClusterConfigActive(context, fileName)
          await fetchConfigs()
        }
        return
      }
      if (action === 'disconnect') {
        await DBDisconnectClusterConfig()
        await fetchConfigs()
        return
      }
      if (action === 'rename') {
        const currentName = getContextName(config) || getClusterName(config)
        const nextName = window.prompt('Rename cluster config', currentName)
        if (!nextName || nextName.trim() === currentName) return
        await DBRenameClusterConfig(currentName, nextName.trim(), getConfigContext(config), getConfigFileName(config))
        await fetchConfigs()
        return
      }
      if (action === 'icon') {
        await AppConfigPickClusterIcon(getConfigContext(config), getConfigFileName(config))
        await fetchConfigs()
        return
      }
      if (action === 'delete') {
        await DBDeleteClusterConfig(getConfigContext(config), getConfigFileName(config))
        await fetchConfigs()
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Action failed')
    }
  }, [fetchConfigs, menuState])


  return (
    <div className={`lucid-shell ${hideHeader ? 'h-full' : 'min-h-screen'} flex flex-col text-foreground`}>

      {/* Header */}
      {!hideHeader && <header className="h-16 flex items-center justify-between px-8 border-b border-border/40">
        <div className="flex items-center gap-3">
          {logoSrc ? (
            <img src={logoSrc} alt="KubeGUI" className="h-8 w-8 object-contain" onError={() => setLogoSrc(null)} />
          ) : (
            <div className="h-8 w-8 bg-primary rounded flex items-center justify-center text-sm font-bold text-on-primary">K</div>
          )}
          <div>
            <div className="text-sm font-bold tracking-tight font-headline">KubeGUI</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Kubernetes client</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 lucid-control rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Engine Ready</span>
        </div>
      </header>}

      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-5%] left-[-5%] w-[35%] h-[35%] rounded-full bg-primary/5 blur-[80px]" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] rounded-full bg-cyan-500/5 blur-[80px]" />
      </div>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-12 relative z-10">
        <div className="max-w-[1100px] mx-auto grid grid-cols-[1fr_420px] gap-8 pt-18">

          {/* Left */}
          <div className="flex flex-col gap-8">
            {/* Hero */}
            <section>
              <h1 className="text-[52px] font-semibold leading-[1.05] tracking-[-2px] mb-4 font-headline">
                Connect to<br />
                <span className="text-primary">Kubernetes Cluster.</span>
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed max-w-[480px]">
                Select a kubeconfig or upload one to begin managing your cluster.
              </p>
            </section>

            {/* Upload zone */}
            <div data-file-drop-target onClick={() => void Events.Emit('addClusterConfig', 'addcluster')} className="lucid-panel rounded-xl border-2 border-dashed border-border/40 hover:border-primary/40 transition-colors p-10 text-center cursor-pointer">
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 lucid-surface rounded-full flex items-center justify-center">
                  <CloudUpload size={24} className="text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold mb-1">Upload Kubeconfig</div>
                  <div className="text-sm text-muted-foreground">Drag & drop YAML or browse files</div>
                </div>
                <button className="mt-1 px-5 py-1.5 lucid-control rounded-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Browse Files
                </button>
              </div>
            </div>

            {/* Auto-detected */}
            <div className="lucid-panel rounded-xl overflow-hidden">
              <div className="px-6 py-3 bg-accent/20 border-b border-border/40 flex justify-between items-center">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Auto-Detected Configs</span>
                <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 font-semibold">
                  {loadingConfigs ? '...' : `${autoDetectedConfigs.length} FOUND`}
                </span>
              </div>
              <div className="p-2">
                {loadingConfigs ? (
                  <div className="py-3 px-2 flex flex-col gap-2">
                    {[0, 1].map((i) => (
                      <div key={i} className="flex items-center gap-3 px-2 py-2">
                        <div className="skeleton w-3.5 h-3.5 rounded-sm shrink-0" />
                        <div className="skeleton w-4 h-4 rounded shrink-0" />
                        <div className="flex flex-col gap-1.5 flex-1">
                          <div className="skeleton h-2.5 w-2/3" />
                          <div className="skeleton h-2 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : autoDetectedConfigs.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground text-sm">No configs discovered.</div>
                ) : (
                  autoDetectedConfigs.map((cfg, i) => (
                    <label key={i} className="flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer hover:bg-accent/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <input type="radio" name="kubeconfig-init" className="w-3.5 h-3.5 accent-primary"
                          checked={selectedConfig === cfg}
                          onChange={() => { setSelectedConfig(cfg); setConnectError(null) }} />
                        <img
                          src={getResolvedIconPath(cfg)}
                          alt="cluster"
                          className="w-4 h-4 object-contain opacity-90"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultClusterIcon }}
                        />
                        <div>
                          <div className="text-sm font-semibold">{getClusterName(cfg) || getContextName(cfg)}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{getContextName(cfg)}</div>
                        </div>
                      </div>
                      <FileText size={13} className="text-muted-foreground/50" />
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: Contexts panel */}
          <div className="flex flex-col gap-4">
            <div className="lucid-panel rounded-xl p-6">
              <div className="mb-5 flex items-end justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight font-headline mb-0.5">Contexts</h2>
                  <p className="text-sm text-muted-foreground">
                    {loadingConfigs ? 'Loading...' : `${configs.length} available`}
                  </p>
                </div>
                {selectedConfig && !loadingConfigs && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border bg-primary/15 border-primary/30 text-primary uppercase tracking-wider">
                    1 selected
                  </span>
                )}
              </div>

              <input
                type="text"
                placeholder="Filter contexts..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="lucid-control w-full rounded-lg px-4 py-2 text-sm mb-4 focus:outline-none"
              />

              {/* Cards grid */}
              <div className="max-h-[400px] overflow-y-auto pr-1">
                {loadingConfigs ? (
                  <ContextCardsSkeleton count={4} />
                ) : filteredConfigs.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-6">
                    {searchQuery ? 'No matches.' : 'No contexts found.'}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredConfigs.map((cfg, i) => {
                      const ctxName  = getContextName(cfg) || getClusterName(cfg)
                      const cluster  = getClusterName(cfg)
                      const user     = getUserName(cfg)
                      const source   = getConfigSource(cfg)
                      const isAuto   = source === AUTO_DETECTED_SOURCE
                      const isActive = isActiveValue(cfg.active) || isActiveValue(cfg.Active)
                      const isSelected = selectedConfig === cfg
                      const cfgKey = `${getConfigFileName(cfg)}|${getConfigContext(cfg)}`

                      return (
                        <button
                          key={i}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setSelectedConfig(cfg)
                            setConnectError(null)
                            setMenuState({ config: cfg, x: e.clientX, y: e.clientY })
                          }}
                          onClick={() => { setSelectedConfig(cfg); setConnectError(null) }}
                          className={`group relative text-left rounded-xl p-3.5 flex flex-col gap-3 transition-all duration-150 border active:scale-[0.98] ${
                            isSelected
                              ? 'lucid-panel ring-1 ring-primary/40 bg-primary/10 border-primary/20'
                              : 'lucid-panel border-transparent hover:ring-1 hover:ring-primary/25 hover:bg-accent/30'
                          }`}
                        >
                          {/* Card header */}
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                                <img
                                  src={getResolvedIconPath(cfg)}
                                  alt="cluster"
                                  className="w-4 h-4 object-contain"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = defaultClusterIcon }}
                                />
                              </div>
                              <span className="font-semibold text-[12px] leading-tight text-foreground truncate">
                                {ctxName}
                              </span>
                            </div>
                            {isSelected
                              ? <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />
                              : isActive
                                ? <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded-full border bg-emerald-500/15 border-emerald-500/30 text-emerald-300 uppercase tracking-wide">Active</span>
                                : null
                            }
                          </div>

                          {/* Divider */}
                          <div className="h-px bg-border/40 -mx-0.5" />

                          {/* Meta info */}
                          <div className="flex flex-col gap-1.5">
                            {cluster && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
                                <Server size={10} className="shrink-0 text-cyan-400/80" />
                                <span className="truncate">{cluster}</span>
                              </div>
                            )}
                            {user && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
                                <User size={10} className="shrink-0 text-violet-400/80" />
                                <span className="truncate">{user}</span>
                              </div>
                            )}
                            {!cluster && !user && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                                <Network size={10} className="shrink-0 text-amber-400/60" />
                                <span>No metadata</span>
                              </div>
                            )}
                          </div>

                          {/* Footer tags */}
                          <div className="flex items-center gap-1.5 flex-wrap mt-auto">
                            {isAuto && (
                              <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                                Auto
                              </span>
                            )}
                            {source && !isAuto && (
                              <span className="flex items-center gap-1 text-[8px] font-medium uppercase tracking-wider text-muted-foreground/60">
                                <FolderOpen size={8} className="text-amber-400/70" />{source}
                              </span>
                            )}
                            {configErrors[cfgKey] && (
                              <span title={configErrors[cfgKey]} className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                                Not working
                              </span>
                            )}
                          </div>


                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <button
                onClick={() => void handleConnect()}
                disabled={isLoading || !selectedConfig}
                className="w-full mt-6 py-3 rounded-lg bg-primary text-on-primary font-bold text-sm tracking-widest uppercase hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed font-headline">
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Connecting...
                  </span>
                ) : 'Connect to Cluster'}
              </button>

              {menuState && createPortal(
                <div
                  className="fixed w-max max-w-[320px] rounded-lg border border-border bg-card shadow-2xl overflow-hidden"
                  style={{ left: menuState.x, top: menuState.y, zIndex: 2147483647 }}
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="border-b border-border/70 py-1">
                    <button type="button" className="block whitespace-nowrap text-left px-3 py-2 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void handleMenuAction('connect') }}>Connect</button>
                    <button type="button" className="block whitespace-nowrap text-left px-3 py-2 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void handleMenuAction('disconnect') }}>Disconnect</button>
                  </div>
                  <div className="border-b border-border/70 py-1">
                    <button type="button" className="block whitespace-nowrap text-left px-3 py-2 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void handleMenuAction('rename') }}>Rename</button>
                    <button type="button" className="block whitespace-nowrap text-left px-3 py-2 text-sm hover:bg-accent/60 min-w-[170px]" onClick={() => { void handleMenuAction('icon') }}>Change Icon</button>
                  </div>
                  <div className="py-1">
                    <button type="button" className="block whitespace-nowrap text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 min-w-[170px]" onClick={() => { void handleMenuAction('delete') }}>Delete</button>
                  </div>
                </div>,
                document.body,
              )}

              {/* Sync progress panel */}
              {syncProgress && (
                <div className="mt-4 rounded-xl border border-border/40 overflow-hidden">
                  <div className="px-4 py-2.5 bg-accent/20 border-b border-border/40 flex items-center gap-2">
                    <Loader2 size={11} className={`${syncProgress.stage === 'synced' ? 'text-emerald-400' : 'text-primary animate-spin'}`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cluster connection</span>
                    <button
                      type="button"
                      onClick={() => void handleCancelConnect()}
                      className="ml-auto text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-0.5 rounded border border-border/40 hover:border-border transition-colors"
                      title="Cancel connection"
                    >
                      <X size={9} /> Cancel
                    </button>
                  </div>
                  <div className="p-3 flex flex-col gap-1.5">
                    {(
                      [
                        { key: 'discovering', icon: <Wifi size={10} />, label: 'Discover resources', color: 'text-cyan-400' },
                        { key: 'discovered',  icon: <Database size={10} />, label: syncProgress.resourceCount ? `${syncProgress.resourceCount} resources found` : 'Resources found', color: 'text-violet-400' },
                        { key: 'started',     icon: <Zap size={10} />, label: 'Informers started', color: 'text-amber-400' },
                        { key: 'synced',      icon: <CheckCircle2 size={10} />, label: 'Caches synced', color: 'text-emerald-400' },
                      ] as { key: InformerStage; icon: ReactNode; label: string; color: string }[]
                    ).map(({ key, icon, label, color }) => {
                      const stages: InformerStage[] = ['connecting', 'discovering', 'discovered', 'started', 'synced']
                      const currentIdx = stages.indexOf(syncProgress.stage)
                      const stepIdx   = stages.indexOf(key)
                      const done    = stepIdx < currentIdx || syncProgress.stage === key && (key === 'synced')
                      const active  = syncProgress.stage === key
                      const pending = stepIdx > currentIdx
                      return (
                        <div key={key} className={`flex items-center gap-2 text-[10px] ${pending ? 'opacity-30' : ''}`}>
                          <span className={`shrink-0 ${done ? 'text-emerald-400' : active ? `${color} animate-pulse` : 'text-muted-foreground/40'}`}>
                            {done ? <CheckCircle2 size={10} /> : icon}
                          </span>
                          <span className={done ? 'text-muted-foreground' : active ? 'text-foreground font-medium' : 'text-muted-foreground/40'}>
                            {label}
                          </span>
                          {active && !done && <Loader2 size={9} className="animate-spin text-muted-foreground/60 ml-auto" />}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {connectError && <p className="mt-3 text-sm text-red-400">{connectError}</p>}
            </div>

            <div className="flex items-start gap-3 px-4 py-3 lucid-panel rounded-xl">
              <span className="text-sm mt-0.5">🔐</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed m-0">
                Air-gap friendly. All kubeconfig data stays local — never transmitted to external services.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-10 flex items-center justify-end px-6 border-t border-border/40 text-[10px] text-muted-foreground font-mono">
        <div className="flex gap-4 items-center">
          <span>v{productVersion}</span>
          <span className="border-l border-border pl-3 text-muted-foreground/50">© 2026 KubeGUI</span>
        </div>
      </footer>
    </div>
  )
}
