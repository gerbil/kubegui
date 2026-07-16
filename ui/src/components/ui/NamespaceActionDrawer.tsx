/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Layers, Pencil, Trash2, X } from 'lucide-react'
import { UiTooltip } from './UiTooltip'
import { uiNotify } from './UiNotify'
import { ResourceManifestOverview, LabelsSection, AnnotationsSection } from './ResourceManifestOverview'
import { namespaceOverviewFields } from '../../features/resources/resourceOverview'
import { ConfirmDialog } from './Button'
import { ResourceList, ResourceGetDetails, ResourceEdit, ResourceDelete } from '../../../bindings/kubegui/services/backend'
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'

async function listResourcesViaBinding(resource: string, namespace: string) {
  const data = await ResourceList(resource, namespace)
  return Array.isArray(data) ? data : []
}

let legacyEditorAssetsPromise: Promise<void> | null = null
const loadedLegacyScripts = new Set<string>()

function scriptUrlCandidates(src: string): string[] {
  return [src]
}

function isLegacyScriptReady(src: string): boolean {
  const w = window as Window & typeof globalThis & { ace?: unknown; jsyaml?: unknown }
  if (src.includes('ace.js')) return Boolean(w.ace)
  if (src.includes('js-yaml.js')) return Boolean(w.jsyaml)
  return false
}

function hasExistingLegacyScriptTag(src: string): boolean {
  const normalizePath = (raw: string) => {
    try { return new URL(raw, window.location.origin).pathname } catch { return raw }
  }
  const candidatePaths = new Set(scriptUrlCandidates(src).map(normalizePath))
  for (const s of Array.from(document.scripts)) {
    const script = s as HTMLScriptElement
    const scriptSrc = script.getAttribute('src') || script.src
    if (!scriptSrc) continue
    if (candidatePaths.has(normalizePath(scriptSrc))) return true
  }
  return false
}

function loadLegacyScript(src: string) {
  const FETCH_TIMEOUT_MS = 15000

  const tryLoad = async (candidate: string) => {
    const injected = document.querySelector(`script[data-legacy-src="${src}"]`) as HTMLScriptElement | null
    if (injected) {
      injected.dataset.loaded = 'true'
      loadedLegacyScripts.add(src)
      return
    }

    if (hasExistingLegacyScriptTag(src)) {
      loadedLegacyScripts.add(src)
      return
    }

    if (isLegacyScriptReady(src) || loadedLegacyScripts.has(src)) return

    const cacheBust = `_kg=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const url = candidate.includes('?') ? `${candidate}&${cacheBust}` : `${candidate}?${cacheBust}`

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let code = ''
    try {
      const res = await window.fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      code = await res.text()
    } finally {
      window.clearTimeout(timeout)
    }

    if (!code.trim()) throw new Error(`Failed to load ${candidate}: empty response`)

    const script = document.createElement('script')
    script.dataset.loaded = 'true'
    script.dataset.legacySrc = src
    script.text = `${code}\n//# sourceURL=${candidate}`
    document.head.appendChild(script)
    loadedLegacyScripts.add(src)

    if (src.includes('ace.js') && !(window as any).ace) throw new Error(`Failed to initialize ${candidate}`)
    if (src.includes('js-yaml.js') && !(window as any).jsyaml) throw new Error(`Failed to initialize ${candidate}`)
  }

  return (async () => {
    let lastErr: Error | null = null
    for (const candidate of scriptUrlCandidates(src)) {
      try {
        await tryLoad(candidate)
        return
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(`Failed to load ${candidate}`)
      }
    }
    throw lastErr ?? new Error(`Failed to load ${src}`)
  })()
}

function ensureLegacyEditorAssets() {
  if (legacyEditorAssetsPromise) return legacyEditorAssetsPromise

  legacyEditorAssetsPromise = (async () => {
    await loadLegacyScript('/assets/js/ace.js')
    await loadLegacyScript('/assets/js/ace-ext-searchbox.js')
    await loadLegacyScript('/assets/js/ace-ext-language-tools.js')
    await loadLegacyScript('/assets/js/ace-mode-yaml.js')
    await loadLegacyScript('/assets/js/theme-idle_fingers.js')
    await loadLegacyScript('/assets/js/js-yaml.js')
  })()

  legacyEditorAssetsPromise.catch(() => {
    legacyEditorAssetsPromise = null
  })

  return legacyEditorAssetsPromise
}

type Tab = 'overview' | 'edit'

type LegacyAceEditor = {
  setValue: (value: string, cursorPos?: number) => void
  getValue: () => string
  setOptions: (options: Record<string, unknown>) => void
  getSession: () => {
    setMode?: (mode: string) => void
    setUseWrapMode?: (enabled: boolean) => void
    setTabSize?: (size: number) => void
    setUseSoftTabs?: (enabled: boolean) => void
    on: (event: string, cb: () => void) => void
    getAnnotations?: () => { type: string; row: number; text: string }[]
    getUndoManager: () => { markClean: () => void; isClean: () => boolean }
  }
  destroy: () => void
  resize?: () => void
}

type LegacyEditorWindow = Window & typeof globalThis & {
  ace?: { edit: (el: HTMLElement | string) => LegacyAceEditor }
  jsyaml?: {
    dump: (value: unknown) => string
    load: (value: string) => unknown
  }
}

export type NamespaceActionTarget = {
  name: string
  phase: string
  createdAt: string
  labels: Record<string, string>
}

interface Props {
  namespace: NamespaceActionTarget | null
  initialTab?: Tab
  onClose: () => void
  onDeleted?: (name: string) => void
  onSaved?: (name: string) => void
}

async function fetchNamespaceResource(name: string): Promise<Record<string, unknown>> {
  try {
    const obj = await ResourceGetDetails('namespaces', '', name)
    if (obj && typeof obj === 'object') return obj as Record<string, unknown>
  } catch {
    // fallback below
  }

  const list = await listResourcesViaBinding('namespaces', 'all')

  const match = list.find((item) => {
    if (!item || typeof item !== 'object') return false
    const meta = (item as Record<string, unknown>).metadata as Record<string, unknown> | undefined
    return String(meta?.name ?? '') === name
  })

  if (!match || typeof match !== 'object') {
    throw new Error(`Namespace ${name} not found`)
  }
  return match as Record<string, unknown>
}

function cleanNamespaceForEdit(resource: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(resource)) as Record<string, unknown>
  const rest = { ...clone }
  delete rest.status
  const metadata = rest.metadata
  if (metadata && typeof metadata === 'object') {
    const meta = metadata as Record<string, unknown>
    delete meta.managedFields
    const annotations = meta.annotations
    if (annotations && typeof annotations === 'object') {
      delete (annotations as Record<string, unknown>)['kubectl.kubernetes.io/last-applied-configuration']
    }
  }
  return rest
}

async function fetchNamespacePodCount(name: string): Promise<number> {
  try {
    const list = await listResourcesViaBinding('pods', name)
    return list.length
  } catch {
    return 0
  }
}

function OverviewTab({ namespace }: { namespace: NamespaceActionTarget }) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [podCount, setPodCount] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)

    Promise.all([
      fetchNamespaceResource(namespace.name),
      fetchNamespacePodCount(namespace.name),
    ])
      .then(([d, pods]) => {
        if (cancelled) return
        setDetails(d)
        setPodCount(pods)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : 'fetch error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [namespace.name])

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading namespace details…</p>
  if (err) return <p className="text-sm text-red-400 p-4">Error: {err}</p>
  if (!details) return <p className="text-sm text-muted-foreground p-4">No details available.</p>

  const labels = (details.metadata as Record<string, unknown> | undefined)?.labels
  const labelCount = labels && typeof labels === 'object' ? Object.keys(labels).length : 0
  const phase = namespace.phase.toLowerCase()
  const statusColor = phase === 'active' ? '#10b981' : phase.includes('terminat') ? '#ef4444' : '#f59e0b'

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="Status" value={namespace.phase} color={statusColor} />
        <MetricCard label="Pods" value={String(podCount)} color="#38bdf8" />
        <MetricCard label="Labels" value={String(labelCount)} color="#a78bfa" />
      </div>
      <ResourceManifestOverview resource={details} fields={namespaceOverviewFields} />
      <LabelsSection resource={details} />
      <AnnotationsSection resource={details} />
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-accent/20 p-3 space-y-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <span className="text-2xl font-bold font-mono leading-none" style={color ? { color } : undefined}>{value}</span>
    </div>
  )
}

function EditTab({ namespace, onSaved }: { namespace: NamespaceActionTarget; onSaved?: (name: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<LegacyAceEditor | null>(null)
  const baselineYamlRef = useRef('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [hasSyntaxError, setHasSyntaxError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const setup = async () => {
      setLoading(true)
      setErr(null)
      setDirty(false)

      try {
        await ensureLegacyEditorAssets()
        if (cancelled) return

        const win = window as LegacyEditorWindow
        if (!hostRef.current || !win.ace || !win.jsyaml) {
          throw new Error('Legacy YAML editor runtime is not available')
        }

        const editor = win.ace.edit(hostRef.current)
        editorRef.current = editor

        configureAceYamlEditor(editor)

        const json = await fetchNamespaceResource(namespace.name)
        const yamlText = win.jsyaml.dump(cleanNamespaceForEdit(json))

        if (cancelled) return

        baselineYamlRef.current = yamlText
        editor.setValue(yamlText, -1)
        editor.getSession().getUndoManager().markClean()

        const refreshFlags = () => {
          setDirty(!editor.getSession().getUndoManager().isClean())
          const annotations = (editor.getSession().getAnnotations?.() ?? []) as { type: string }[]
          setHasSyntaxError(annotations.some((a) => a?.type === 'error'))
        }
        editor.getSession().on('change', refreshFlags)
        editor.getSession().on('changeAnnotation', refreshFlags)
        refreshFlags()
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'editor setup failed'
        setErr(msg)
        uiNotify.error(`Failed to load namespace YAML editor: ${msg}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void setup()

    return () => {
      cancelled = true
      const editor = editorRef.current
      editorRef.current = null
      if (editor) editor.destroy()
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [namespace.name])

  const save = async () => {
    const editor = editorRef.current
    if (!editor) return
    if (hasSyntaxError) {
      setErr('YAML validation failed. Fix editor errors before saving.')
      return
    }

    setSaving(true)
    setErr(null)
    try {
      const win = window as LegacyEditorWindow
      if (!win.jsyaml) throw new Error('YAML parser is not available')

      const yamlText = editor.getValue()
      const parsedPatch = win.jsyaml.load(yamlText)
      const clone = parsedPatch && typeof parsedPatch === 'object'
        ? (JSON.parse(JSON.stringify(parsedPatch)) as Record<string, unknown>)
        : ({} as Record<string, unknown>)

      delete clone.status
      const metadata = clone.metadata
      if (metadata && typeof metadata === 'object') {
        const meta = metadata as Record<string, unknown>
        delete meta.resourceVersion
        delete meta.managedFields
        delete meta.uid
        delete meta.creationTimestamp
        delete meta.generation
      }

      const formBody = new URLSearchParams({ patch: JSON.stringify(clone) })
      await ResourceEdit('namespaces', '', namespace.name, formBody.get('patch') ?? JSON.stringify(clone))

      baselineYamlRef.current = yamlText
      editor.getSession().getUndoManager().markClean()
      setDirty(false)
      uiNotify.success(`Namespace ${namespace.name} updated successfully`)
      onSaved?.(namespace.name)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'save failed'
      setErr(msg)
      uiNotify.error(`YAML save failed: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.setValue(baselineYamlRef.current, -1)
    editor.getSession().getUndoManager().markClean()
    setDirty(false)
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {err && <p className="text-sm text-red-400">Error: {err}</p>}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span className="font-mono"></span>
        <span>{loading ? 'Loading…' : hasSyntaxError ? '⚠ YAML syntax error' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
      </div>

      <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden">
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/70">
            Loading YAML editor…
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={discard}
          disabled={loading || saving || !dirty}
          className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90"
        >
          Discard
        </button>
        <button
          onClick={() => void save()}
          disabled={loading || saving || !dirty || hasSyntaxError}
          className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

export function NamespaceActionDrawer({ namespace, initialTab = 'overview', onClose, onDeleted, onSaved }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [busy, setBusy] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  useEffect(() => {
    if (namespace) setActiveTab(initialTab)
  }, [namespace?.name, initialTab])

  useEffect(() => {
    if (!namespace) {
      setConfirmDeleteOpen(false)
      setBusy(false)
    }
  }, [namespace])

  const deleteNamespace = async () => {
    if (!namespace) return
    setBusy(true)
    const nameToDelete = namespace.name
    try {
      // Pause Choices to prevent DOM mutations during React reconciliation
      if (typeof window !== 'undefined') {
        (window as any).__choicesPaused = true
      }
      await ResourceDelete('namespaces', '', nameToDelete)
      uiNotify.success(`Deleted namespace ${nameToDelete}`)
      // Close the drawer first, then notify parent after animation finishes
      onClose()
      setTimeout(() => {
        onDeleted?.(nameToDelete)
        // Resume Choices after state updates complete
        if (typeof window !== 'undefined') {
          (window as any).__choicesPaused = false
        }
      }, 220)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'delete failed'
      uiNotify.error(`Delete failed: ${msg}`)
      setBusy(false)
      // Resume Choices on error
      if (typeof window !== 'undefined') {
        (window as any).__choicesPaused = false
      }
    }
  }

  const visible = namespace !== null

  const drawer = (
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[999] transition-opacity duration-200 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 bottom-0 right-0 h-[100dvh] max-h-[100dvh] w-[760px] max-w-[100vw] z-[1000] flex flex-col overflow-hidden bg-card border-l border-border shadow-2xl transition-transform duration-200 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20">
          <div className="flex-1 min-w-0">
           <div className="flex items-center gap-2 mb-1">
             <Layers size={15} className="text-primary shrink-0" />
             <span className="font-mono text-sm font-bold text-foreground truncate">{namespace?.name}</span>
           </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              <span>{namespace?.phase}</span> &nbsp;·&nbsp;
              <span>{namespace?.createdAt}</span>
            </p>
          </div>
          <UiTooltip content="Close panel" side="bottom">
            <button onClick={onClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
              <X size={18} />
            </button>
          </UiTooltip>
        </div>

        <div className="flex items-center gap-0 border-b border-border bg-accent/10 px-5">
           <button
             onClick={() => setActiveTab('overview')}
             className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
               activeTab === 'overview'
                 ? 'border-primary text-primary'
                 : 'border-transparent text-muted-foreground hover:text-foreground'
             }`}
           >
             <Layers size={13} />Overview
           </button>
          <button
            onClick={() => setActiveTab('edit')}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
              activeTab === 'edit'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Pencil size={13} />Edit YAML
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2 py-2">
            <ActionBtn icon={<Trash2 size={13} />} label="Delete" onClick={() => setConfirmDeleteOpen(true)} disabled={busy} danger />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {namespace && activeTab === 'overview' && <OverviewTab namespace={namespace} />}
          {namespace && activeTab === 'edit' && <EditTab namespace={namespace} onSaved={onSaved} />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete namespace "${namespace?.name ?? ''}"`}
        description="This will delete the namespace and all resources within it."
        confirmLabel="Delete namespace"
        onConfirm={() => {
          setConfirmDeleteOpen(false)
          window.setTimeout(() => { void deleteNamespace() }, 0)
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(drawer, document.body)
}

function ActionBtn({
  icon, label, onClick, disabled = false, danger = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/60'
      }`}
    >
      {icon}{label}
    </button>
  )
}
