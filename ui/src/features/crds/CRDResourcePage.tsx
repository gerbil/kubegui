import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Search } from 'lucide-react'
import { Select as MantineSelect } from '@mantine/core'
import { Events } from '@wailsio/runtime'
import { ResourceList, ResourceAdd, ResourceDelete, CRDGenerateTemplate } from '../../../bindings/kubegui/services/backend'
import type { CRDDefinition } from '../../../bindings/kubegui/internal/resources/informers/models'
import { formatAge } from '@/lib/utils'
import { uiNotify } from '@/components/ui/UiNotify'
import { ConfirmDialog } from '@/components/ui/Button'
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'
import { useNamespaceOptions } from '@/hooks/useNamespaceOptions'
import { ResourceDrawer, type ResourceRef } from '@/components/ui/ResourceDrawer'

type LegacyAce = {
  edit: (el: HTMLElement) => any
}
type JsYamlWindow = Window & typeof globalThis & { ace?: LegacyAce; jsyaml?: { load: (v: string) => unknown } }

type CRDColumnMetadata = {
  name: string
  jsonPath?: string
  type?: string
  format?: string
  description?: string
  priority?: number
}

type CRDDefinitionWithColumnDetails = CRDDefinition & { columnDetails?: CRDColumnMetadata[] }

type CRDTableColumn = {
  key: string
  label: string
  jsonPath?: string
  isAge?: boolean
  valueType?: string
  valueFormat?: string
}

type CRDSortState = { key: string; desc: boolean } | null

const SELECT_CHECKBOX_CLASS = 'w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]'
const FIRST_COLUMN_STRICT_WIDTH = 64
const SORT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function getResourceName(item: Record<string, any>): string {
  return String(item.metadata?.name ?? '')
}

function getResourceNamespace(item: Record<string, any>): string {
  return String(item.metadata?.namespace ?? '')
}

function getResourceSelectionKey(item: Record<string, any>): string {
  return `${getResourceNamespace(item)}\u0000${getResourceName(item)}`
}

function getResourceAPIVersion(definition: CRDDefinition, item: Record<string, any>): string | undefined {
  if (typeof item.apiVersion === 'string' && item.apiVersion.trim()) return item.apiVersion
  const version = definition.versions?.[0]
  if (!version) return undefined
  return definition.group ? `${definition.group}/${version}` : version
}

function toResourceRef(definition: CRDDefinition, item: Record<string, any>): ResourceRef {
  const namespace = getResourceNamespace(item)
  return {
    uid: typeof item.metadata?.uid === 'string' ? item.metadata.uid : undefined,
    name: getResourceName(item),
    namespace: namespace || undefined,
    kind: typeof item.kind === 'string' && item.kind.trim() ? item.kind : definition.kind,
    apiVersion: getResourceAPIVersion(definition, item),
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('button,input,select,textarea,a,[role="button"]'))
}

function hasWailsBridge(): boolean {
  return typeof window !== 'undefined' && ('__wails' in window || '_wails' in window)
}

/**
 * Safely resolve a dotted path from an object.
 * e.g. getNestedValue(obj, "spec.replicas") -> obj.spec.replicas
 */
function getNestedValue(obj: Record<string, any>, dotPath: string): unknown {
  if (!dotPath) return ''
  const parts = dotPath.replace(/^\./, '').split('.')
  let cur: any = obj
  for (const part of parts) {
    if (cur == null) return ''
    cur = cur[part]
  }
  if (cur == null) return ''
  return cur
}

function stripJSONPath(path: string): string {
  let expr = path.trim()
  if (expr.startsWith('{') && expr.endsWith('}')) expr = expr.slice(1, -1).trim()
  if (expr.startsWith('$')) expr = expr.slice(1)
  return expr
}

function splitFieldPath(path: string): string[] {
  return path.split('.').map((part) => part.trim()).filter(Boolean)
}

function readFieldPath(value: unknown, path: string): unknown {
  let cur: any = value
  for (const part of splitFieldPath(path)) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function readJSONPath(obj: Record<string, any>, path?: string): unknown[] {
  if (!path) return []
  const expr = stripJSONPath(path)
  if (!expr) return []

  let current: unknown[] = [obj]
  let i = 0

  const applyField = (field: string) => {
    if (!field) return
    current = current.flatMap((entry: any) => {
      if (entry == null || typeof entry !== 'object') return []
      const value = entry[field]
      return value == null ? [] : [value]
    })
  }

  const applyBracket = (content: string) => {
    const raw = content.trim()
    if (raw === '*') {
      current = current.flatMap((entry: any) => Array.isArray(entry) ? entry : (entry && typeof entry === 'object' ? Object.values(entry) : []))
      return
    }

    const quotedField = raw.match(/^['"](.+)['"]$/)
    if (quotedField) {
      applyField(quotedField[1])
      return
    }

    const index = Number(raw)
    if (Number.isInteger(index)) {
      current = current.flatMap((entry: any) => Array.isArray(entry) && entry[index] != null ? [entry[index]] : [])
      return
    }

    const filter = raw.match(/^\?\(@\.([\w.\-]+)\s*(==|!=)\s*['"]?([^'"]+)['"]?\)$/)
    if (filter) {
      const [, fieldPath, op, expected] = filter
      current = current.flatMap((entry: any) => {
        if (!Array.isArray(entry)) return []
        return entry.filter((item) => {
          const actual = readFieldPath(item, fieldPath)
          const matches = String(actual) === expected
          return op === '==' ? matches : !matches
        })
      })
    }
  }

  while (i < expr.length) {
    const ch = expr[i]
    if (ch === '.') { i += 1; continue }
    if (ch === '[') {
      const end = expr.indexOf(']', i)
      if (end === -1) break
      applyBracket(expr.slice(i + 1, end))
      i = end + 1
      continue
    }
    let end = i
    while (end < expr.length && expr[end] !== '.' && expr[end] !== '[') end += 1
    applyField(expr.slice(i, end).replace(/\\\./g, '.'))
    i = end
  }

  return current.filter((value) => value != null && value !== '')
}

function summarizeObject(value: Record<string, unknown>): string {
  const name = value.name ?? value.Name
  const kind = value.kind ?? value.Kind
  const type = value.type ?? value.Type
  const status = value.status ?? value.Status
  const reason = value.reason ?? value.Reason
  const simple = [kind, name].filter(Boolean).join('/') || type || name || status || reason
  if (simple != null && typeof simple !== 'object') return String(simple)

  const entries = Object.entries(value).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return '{}'
  return `{${entries.slice(0, 3).map(([k, v]) => `${k}: ${formatCRDValue(v)}`).join(', ')}${entries.length > 3 ? ', …' : ''}}`
}

function formatCRDValue(value: unknown): string {
  if (value == null || value === '') return ''
  if (Array.isArray(value)) {
    const rendered = value.map(formatCRDValue).filter(Boolean)
    return rendered.join(', ')
  }
  if (typeof value === 'object') return summarizeObject(value as Record<string, unknown>)
  return String(value)
}

function getRawCRDColumnValue(item: Record<string, any>, col: CRDTableColumn): unknown {
  const meta = item.metadata ?? {}
  if (col.key === 'name') return meta.name
  if (col.key === 'namespace') return meta.namespace
  if (col.isAge) return meta.creationTimestamp

  const jsonPathValues = readJSONPath(item, col.jsonPath)
  if (jsonPathValues.length === 1) return jsonPathValues[0]
  if (jsonPathValues.length > 1) return jsonPathValues

  const label = col.label.toLowerCase()
  const status = item.status ?? {}
  const spec = item.spec ?? {}
  if (label in status) return status[label]
  if (label in spec) return spec[label]
  return getNestedValue(item, `.status.${col.label}`) ||
         getNestedValue(item, `.spec.${col.label}`) ||
         getNestedValue(item, `.${col.label}`)
}

function getCRDColumnDisplayValue(item: Record<string, any>, col: CRDTableColumn): string {
  if (col.isAge) return formatAge(item.metadata?.creationTimestamp)
  return formatCRDValue(getRawCRDColumnValue(item, col)) || '—'
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/,/g, '')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSortValue(value: unknown, col: CRDTableColumn): string | number | boolean | undefined {
  if (Array.isArray(value)) value = formatCRDValue(value)
  if (value == null || value === '' || value === '—') return undefined

  const type = col.valueType?.toLowerCase()
  const format = col.valueFormat?.toLowerCase()
  if (col.isAge || type === 'date' || format === 'date-time') {
    const time = new Date(String(value)).getTime()
    return Number.isFinite(time) ? time : undefined
  }

  if (type === 'integer' || type === 'number') return parseFiniteNumber(value) ?? undefined
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    const normalized = String(value).trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  const numeric = parseFiniteNumber(value)
  if (numeric != null) return numeric
  if (typeof value === 'boolean') return value
  return String(value)
}

function compareSortValues(a: string | number | boolean, b: string | number | boolean): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return SORT_COLLATOR.compare(String(a), String(b))
}

function capitalizeFirst(str: string): string {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function resolveCRDColumns(definition: CRDDefinition): CRDTableColumn[] {
  const detailed = (definition as CRDDefinitionWithColumnDetails).columnDetails ?? []
  if (detailed.length > 0) {
    return detailed.map((col, idx) => ({
      key: `${col.name}:${col.jsonPath ?? idx}`,
      label: capitalizeFirst(col.name),
      jsonPath: col.jsonPath,
      valueType: col.type,
      valueFormat: col.format,
    }))
  }
  return (definition.columns ?? []).map((col) => ({ key: col, label: capitalizeFirst(col) }))
}

function buildFallbackYaml(def: CRDDefinition): string {
  const version = def.versions?.[0] ?? 'v1'
  const apiVersion = def.group ? `${def.group}/${version}` : version
  const isNamespaced = def.scope === 'Namespaced'
  const kindLower = def.kind.toLowerCase()
  return [
    `apiVersion: ${apiVersion}`,
    `kind: ${def.kind}`,
    `metadata:`,
    `  name: my-${kindLower}`,
    isNamespaced ? `  namespace: default` : null,
    `spec: {}`,
  ].filter(Boolean).join('\n') + '\n'
}

function CreateCRDResourceModal({
  definition,
  initialYaml,
  onClose,
}: {
  definition: CRDDefinition
  initialYaml: string
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<any>(null)
  const [busy, setBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [hasSyntaxError, setHasSyntaxError] = useState(false)
  const [visible, setVisible] = useState(false)

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
    const containerEl = containerRef.current
    const init = async () => {
      try {
        const { ensureLegacyEditorAssets } = await import('@/components/ui/podLegacyAssets')
        await ensureLegacyEditorAssets()
        if (destroyed || !containerEl) return
        const win = window as JsYamlWindow
        if (!win.ace) { setEditorError('Ace editor not available'); return }
        const editor = win.ace.edit(containerEl)
        configureAceYamlEditor(editor, { onValidationChange: setHasSyntaxError })
        editor.setValue(initialYaml, -1)
        editor.getSession().getUndoManager().markClean()
        editorRef.current = editor
        editor.resize?.()
      } catch (e) {
        if (!destroyed) setEditorError(e instanceof Error ? e.message : 'Failed to load editor')
      }
    }
    void init()
    return () => {
      destroyed = true
      const editor = editorRef.current
      editorRef.current = null
      if (editor) { try { editor.destroy() } catch { /* ignore */ } }
      if (containerEl) containerEl.innerHTML = ''
    }
  }, [initialYaml])

  const handleCreate = async () => {
    if (hasSyntaxError) {
      uiNotify.error('YAML validation failed. Fix editor errors before creating.')
      return
    }
    const win = window as JsYamlWindow
    const yaml = editorRef.current?.getValue() ?? initialYaml
    let obj: unknown
    try {
      obj = win.jsyaml ? win.jsyaml.load(yaml) : JSON.parse(yaml)
    } catch (e) {
      uiNotify.error(`Invalid YAML: ${e instanceof Error ? e.message : 'parse error'}`)
      return
    }
    const meta = (obj as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined
    const name = String(meta?.name ?? '').trim()
    if (!name) { uiNotify.error('metadata.name is required'); return }

    setBusy(true)
    try {
      await ResourceAdd(definition.plural, JSON.stringify(obj))
      uiNotify.success(`${definition.kind} "${name}" created`)
      destroyEditor()
      onClose()
    } catch (err) {
      uiNotify.error(err instanceof Error ? err.message : 'unknown error')
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
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border bg-accent/20 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>
              <span className="font-mono text-sm font-bold text-foreground">New {definition.kind}</span>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">Edit the YAML manifest and click Create</p>
          </div>
          <button onClick={handleClose} className="ml-4 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-3">
          <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden">
            {editorError
              ? <div className="p-4 text-red-400 text-sm">{editorError}</div>
              : <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
            }
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-accent/10 shrink-0">
          <button type="button" onClick={handleClose} disabled={busy} className="px-4 py-1.5 rounded text-sm font-semibold text-muted-foreground border border-border hover:text-foreground transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleCreate()} disabled={busy || hasSyntaxError} className="px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90">
            {busy ? 'Creating…' : `Create ${definition.kind}`}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

interface Props {
  definition: CRDDefinition
  namespace?: string
  onNavigateBack?: () => void
  canGenerateTemplate?: boolean
}

export function CRDResourcePage({ definition, namespace = '', onNavigateBack, canGenerateTemplate = true }: Props) {
  const [items, setItems] = useState<Record<string, any>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNamespace, setSelectedNamespace] = useState(namespace || 'all')
  const [globalFilter, setGlobalFilter] = useState('')
  const [createModalYaml, setCreateModalYaml] = useState<string | null>(null)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [drawerResource, setDrawerResource] = useState<ResourceRef | null>(null)
  const [sort, setSort] = useState<CRDSortState>({ key: 'name', desc: false })

  const { namespaces: namespaceList } = useNamespaceOptions()
  const namespaces = useMemo(() => ['all', ...namespaceList], [namespaceList])

  const columns = useMemo(() => resolveCRDColumns(definition), [definition])
  const isNamespaced = definition.scope === 'Namespaced'

  const load = useCallback(() => {
    if (!hasWailsBridge()) { setLoading(false); return }
    setLoading(true)
    setError(null)
    ResourceList(definition.plural, isNamespaced ? (selectedNamespace === 'all' ? '' : selectedNamespace) : '')
      .then((data) => { setItems(data ?? []) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load resources'))
      .finally(() => setLoading(false))
  }, [definition.plural, isNamespaced, selectedNamespace])

  useEffect(() => { load() }, [load])

  // Live updates: re-fetch whenever the informer fires an event for this resource
  useEffect(() => {
    if (!hasWailsBridge()) return
    const eventName = `${definition.plural}InformerChanged`
    const off = Events.On(eventName, () => { load() })
    const interval = window.setInterval(() => { load() }, 30000)
    return () => { off(); clearInterval(interval) }
  }, [definition.plural, load])

  const handleCreateClose = useCallback(() => {
    setCreateModalYaml(null)
    load()
  }, [load])

  const handleDrawerClose = useCallback(() => {
    setDrawerResource(null)
    load()
  }, [load])

  const handleNewClick = useCallback(async () => {
    if (!canGenerateTemplate) { setCreateModalYaml(buildFallbackYaml(definition)); return }
    if (!hasWailsBridge()) { setCreateModalYaml(buildFallbackYaml(definition)); return }
    setTemplateLoading(true)
    try {
      const yaml = await CRDGenerateTemplate(definition.group, definition.plural)
      setCreateModalYaml(yaml && yaml.trim() ? yaml : buildFallbackYaml(definition))
    } catch {
      setCreateModalYaml(buildFallbackYaml(definition))
    } finally {
      setTemplateLoading(false)
    }
  }, [definition, canGenerateTemplate])

  useEffect(() => {
    const validKeys = new Set(items.map(getResourceSelectionKey))
    setSelectedKeys((prev) => {
      const next = new Set([...prev].filter((key) => validKeys.has(key)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const allColumns = useMemo<CRDTableColumn[]>(() => [
    { key: 'name', label: 'Name' },
    ...(isNamespaced ? [{ key: 'namespace', label: 'Namespace' }] : []),
    ...columns,
    { key: 'age', label: 'Age', isAge: true, valueType: 'date', valueFormat: 'date-time' },
  ], [columns, isNamespaced])

  const getCellValue = useCallback((item: Record<string, any>, col: CRDTableColumn): string => {
    return getCRDColumnDisplayValue(item, col)
  }, [])

  const filteredItems = useMemo(() => {
    if (!globalFilter.trim()) return items
    const q = globalFilter.trim().toLowerCase()
    return items.filter((item) => {
      const meta = item.metadata ?? {}
      return (
        String(meta.name ?? '').toLowerCase().includes(q) ||
        String(meta.namespace ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, globalFilter])

  const sortedItems = useMemo(() => {
    if (!sort) return filteredItems
    const sortColumn = allColumns.find((col) => col.key === sort.key)
    if (!sortColumn) return filteredItems

    return filteredItems
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aValue = normalizeSortValue(getRawCRDColumnValue(a.item, sortColumn), sortColumn)
        const bValue = normalizeSortValue(getRawCRDColumnValue(b.item, sortColumn), sortColumn)

        if (aValue == null && bValue == null) return a.index - b.index
        if (aValue == null) return 1
        if (bValue == null) return -1

        const result = compareSortValues(aValue, bValue)
        return result === 0 ? a.index - b.index : (sort.desc ? -result : result)
      })
      .map(({ item }) => item)
  }, [allColumns, filteredItems, sort])

  const toggleSort = useCallback((key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, desc: false }
      if (!prev.desc) return { key, desc: true }
      return null
    })
  }, [])

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(getResourceSelectionKey(item))),
    [items, selectedKeys],
  )

  const selectedNames = useMemo(
    () => selectedItems.map((item) => {
      const name = getResourceName(item)
      const ns = getResourceNamespace(item)
      return ns ? `${ns}/${name}` : name
    }).join(', '),
    [selectedItems],
  )

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedKeys.has(getResourceSelectionKey(item)))

  const toggleAllFiltered = useCallback((checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      filteredItems.forEach((item) => {
        const key = getResourceSelectionKey(item)
        if (checked) next.add(key)
        else next.delete(key)
      })
      return next
    })
  }, [filteredItems])

  const toggleItem = useCallback((item: Record<string, any>, checked: boolean) => {
    const key = getResourceSelectionKey(item)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const deleteSelected = useCallback(async () => {
    if (selectedItems.length === 0 || bulkDeleteBusy) return
    setBulkDeleteBusy(true)
    try {
      const results = await Promise.allSettled(
        selectedItems.map(async (item) => {
          const name = getResourceName(item)
          const ns = getResourceNamespace(item)
          await ResourceDelete(definition.plural, isNamespaced ? ns : '', name)
          return getResourceSelectionKey(item)
        }),
      )

      const deletedKeys = new Set<string>()
      const failed: string[] = []
      results.forEach((result) => {
        if (result.status === 'fulfilled') deletedKeys.add(result.value)
        else failed.push(result.reason instanceof Error ? result.reason.message : 'Delete failed')
      })

      if (deletedKeys.size > 0) {
        setItems((prev) => prev.filter((item) => !deletedKeys.has(getResourceSelectionKey(item))))
        setSelectedKeys((prev) => new Set([...prev].filter((key) => !deletedKeys.has(key))))
      }

      if (failed.length === 0) uiNotify.success(`Deleted ${deletedKeys.size} ${definition.kind}(s)`)
      else uiNotify.error(`Deleted ${deletedKeys.size}/${selectedItems.length}. ${failed[0]}`)
    } finally {
      setBulkDeleteBusy(false)
    }
  }, [bulkDeleteBusy, definition.kind, definition.plural, isNamespaced, selectedItems])

  return (
    <div className="flex-1 min-h-0 min-w-0 px-12 py-8 flex flex-col gap-5 overflow-hidden">
      {createModalYaml !== null && (
        <CreateCRDResourceModal definition={definition} initialYaml={createModalYaml} onClose={handleCreateClose} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            {onNavigateBack && (
              <>
                <button onClick={onNavigateBack} className="hover:text-foreground transition-colors cursor-pointer">
                  CRD Definitions
                </button>
                <ChevronRight size={12} />
              </>
            )}
            <span className="text-foreground/70">{definition.group}</span>
            <ChevronRight size={12} />
            <span className="text-foreground">{definition.kind}</span>
          </div>
          <h3 className="text-3xl font-bold tracking-tight font-headline">{definition.kind}</h3>
          <p className="text-sm text-muted-foreground">
            {definition.plural}.{definition.group}
            {' · '}
            {definition.scope === 'Namespaced' ? 'Namespaced' : 'Cluster-scoped'}
            {' · '}
            {definition.versions?.join(', ')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleNewClick()}
          disabled={templateLoading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/20 transition-all duration-150 active:scale-[0.97] disabled:opacity-60"
        >
          <span className="flex items-center justify-center w-4 h-4 rounded bg-primary text-primary-foreground shrink-0">
            {templateLoading ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            )}
          </span>
          {templateLoading ? 'Generating…' : `New ${definition.kind}`}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Toolbar — same style as all other views */}
      <div className="lucid-surface pods-glass-surface rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap relative z-[120] overflow-visible min-w-0">
        <div className="flex items-center gap-3 flex-wrap overflow-visible min-w-0">
          {isNamespaced && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-label shrink-0" htmlFor="crd-resource-namespace">Namespace</label>
              <MantineSelect
                id="crd-resource-namespace"
                value={selectedNamespace}
                onChange={(v) => setSelectedNamespace(v ?? 'all')}
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
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={`Filter ${definition.kind.toLowerCase()}...`}
              className="lucid-control rounded pl-7 pr-3 py-1 text-[10px] min-w-[200px] focus:outline-none font-label"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {selectedItems.length > 0 && (
            <div className="lucid-control flex items-center gap-1.5 rounded text-sm focus:outline-none px-2 py-1.5 bg-[#0f172a80] min-w-0 max-w-full">
              <span className="text-[10px] tracking-wider text-muted-foreground min-w-0 max-w-[460px] truncate" title={selectedNames}>
                Selected: {selectedNames}
              </span>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={bulkDeleteBusy}
                className="px-1 py-0 rounded text-[10px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 shrink-0"
              >
                {bulkDeleteBusy ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {loading ? 'Loading...' : `${filteredItems.length} ${definition.plural}`}
        </span>
      </div>

      {loading && items.length === 0 ? (
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
      ) : filteredItems.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
          {globalFilter ? `No ${definition.kind} resources matching "${globalFilter}".` : `No ${definition.kind} resources found.`}
        </div>
      ) : (
        <div className="lucid-surface rounded-lg overflow-y-auto overflow-x-hidden flex-1 min-h-0 min-w-0">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-container-high/60 backdrop-blur-md">
              <tr>
                <th
                  style={{ width: FIRST_COLUMN_STRICT_WIDTH, minWidth: FIRST_COLUMN_STRICT_WIDTH, maxWidth: FIRST_COLUMN_STRICT_WIDTH }}
                  className="px-3 py-2.5 text-left text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b border-outline-variant/40 whitespace-nowrap overflow-hidden text-ellipsis"
                >
                  <input
                    type="checkbox"
                    className={SELECT_CHECKBOX_CLASS}
                    checked={allFilteredSelected}
                    onChange={(e) => toggleAllFiltered(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                {allColumns.map((col) => {
                  const activeSort = sort?.key === col.key ? sort : null
                  return (
                    <th
                      key={col.key}
                      className="px-3 py-2.5 text-left text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b border-outline-variant/40 whitespace-nowrap overflow-hidden text-ellipsis select-none"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="inline-flex items-center gap-1 min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap hover:text-foreground transition-colors cursor-pointer"
                        title={`Sort by ${col.label}`}
                      >
                        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{col.label}</span>
                        <span className="opacity-50 shrink-0">
                          {activeSort?.desc === false ? (
                            <ArrowUp size={12} />
                          ) : activeSort?.desc === true ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ArrowUpDown size={12} />
                          )}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item, idx) => {
                const name = item.metadata?.name ?? String(idx)
                const ns = item.metadata?.namespace ?? ''
                const key = `${ns}/${name}/${idx}`
                return (
                  <tr
                    key={key}
                    className="border-b border-outline-variant/30 hover:bg-surface-container-high/45 focus-within:bg-surface-container-high/45 transition-colors cursor-pointer"
                    onClick={(event) => {
                      if (isInteractiveTarget(event.target)) return
                      setDrawerResource(toResourceRef(definition, item))
                    }}
                    onKeyDown={(event) => {
                      if ((event.key !== 'Enter' && event.key !== ' ') || isInteractiveTarget(event.target)) return
                      event.preventDefault()
                      setDrawerResource(toResourceRef(definition, item))
                    }}
                    tabIndex={0}
                  >
                    <td
                      style={{ width: FIRST_COLUMN_STRICT_WIDTH, minWidth: FIRST_COLUMN_STRICT_WIDTH, maxWidth: FIRST_COLUMN_STRICT_WIDTH }}
                      className="px-3 py-2 text-sm text-foreground/80 whitespace-nowrap overflow-hidden text-ellipsis"
                    >
                      <input
                        type="checkbox"
                        className={SELECT_CHECKBOX_CLASS}
                        checked={selectedKeys.has(getResourceSelectionKey(item))}
                        onChange={(e) => toggleItem(item, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    {allColumns.map((col) => (
                      <td key={col.key} className="px-3 py-2 text-sm text-foreground/80 whitespace-nowrap overflow-hidden text-ellipsis max-w-0">
                        {col.key === 'name'
                          ? <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">{getCellValue(item, col)}</span>
                          : getCellValue(item, col)
                        }
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete ${selectedItems.length} ${definition.kind}(s)?`}
        description={`Selected: ${selectedNames}`}
        confirmLabel={`Delete ${selectedItems.length} ${definition.kind}(s)`}
        onConfirm={() => { setConfirmDeleteOpen(false); void deleteSelected() }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      <ResourceDrawer
        resource={drawerResource}
        resourceType={definition.plural}
        onClose={handleDrawerClose}
      />
    </div>
  )
}
