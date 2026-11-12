import { useEffect, useRef, useState } from 'react'
import { ensureLegacyEditorAssets } from '@/components/ui/podLegacyAssets'
import { configureAceYamlEditor } from '@/lib/aceEditorConfig'

type AceEditor = {
  setValue: (value: string, cursorPosition?: number) => void
  getValue: () => string
  setReadOnly: (readOnly: boolean) => void
  getSession: () => {
    on: (event: string, callback: () => void) => void
    getUndoManager: () => { markClean: () => void }
  }
  resize: () => void
  destroy: () => void
}

type EditorWindow = Window & {
  ace?: { edit: (element: HTMLElement) => AceEditor }
  jsyaml?: { load: (value: string) => unknown }
}

type Props = {
  initialYaml: string
  onSubmit: (yaml: string) => Promise<void>
  submitLabel: string
  mode: 'create' | 'edit'
  onCancel?: () => void
}

export function ArgoYamlEditor({ initialYaml, onSubmit, submitLabel, mode, onCancel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<AceEditor | null>(null)
  const baselineRef = useRef(initialYaml)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [empty, setEmpty] = useState(!initialYaml.trim())
  const [syntaxError, setSyntaxError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const setup = async () => {
      try {
        await ensureLegacyEditorAssets()
        if (cancelled) return
        const win = window as EditorWindow
        if (!hostRef.current || !win.ace || !win.jsyaml) {
          throw new Error('YAML editor or parser is unavailable')
        }
        const parser = win.jsyaml
        const editor = win.ace.edit(hostRef.current)
        editorRef.current = editor
        configureAceYamlEditor(editor)
        const validate = () => {
          const value = editor.getValue()
          setDirty(value !== baselineRef.current)
          setEmpty(!value.trim())
          try {
            parser.load(value)
            setSyntaxError(null)
          } catch (e) {
            setSyntaxError(e instanceof Error ? e.message : 'Invalid YAML')
          }
        }
        editor.getSession().on('change', validate)
        editor.setValue(initialYaml, -1)
        editor.getSession().getUndoManager().markClean()
        validate()
        editor.resize()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load YAML editor')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void setup()
    return () => {
      cancelled = true
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [initialYaml])

  const submit = async () => {
    const editor = editorRef.current
    if (!editor || busy) return
    const yaml = editor.getValue()
    if (!yaml.trim()) {
      setError('YAML cannot be empty.')
      return
    }
    try {
      const parser = (window as EditorWindow).jsyaml
      if (!parser) throw new Error('YAML parser is unavailable')
      parser.load(yaml)
    } catch (e) {
      setSyntaxError(e instanceof Error ? e.message : 'Invalid YAML')
      return
    }
    setBusy(true)
    setError(null)
    editor.setReadOnly(true)
    try {
      await onSubmit(yaml)
      if (editorRef.current === editor) {
        baselineRef.current = yaml
        editor.getSession().getUndoManager().markClean()
        setDirty(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save application')
    } finally {
      if (editorRef.current === editor) {
        editor.setReadOnly(false)
        setBusy(false)
      }
    }
  }

  const discard = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.setValue(baselineRef.current, -1)
    editor.getSession().getUndoManager().markClean()
    setDirty(false)
  }

  const buttonClass = 'px-4 py-1.5 rounded text-sm font-semibold lucid-button text-foreground border border-border disabled:opacity-50 transition-colors hover:opacity-90'

  return (
    <div className={`flex flex-col gap-3 ${mode === 'create' ? 'flex-1 min-h-0' : 'h-[calc(100dvh-230px)] min-h-[300px]'}`}>
      {error && <p role="alert" className="text-sm text-red-400 whitespace-pre-wrap">Error: {error}</p>}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
        <span className="font-mono">YAML</span>
        <span>{loading ? 'Loading…' : syntaxError ? '⚠ YAML syntax error' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
      </div>
      {syntaxError && <p role="alert" className="text-xs text-red-400 whitespace-pre-wrap">{syntaxError}</p>}
      <div className="relative flex-1 min-h-0 rounded border border-border bg-[#0d1117] overflow-hidden">
        <div ref={hostRef} aria-label="Application YAML editor" style={{ position: 'absolute', inset: 0 }} />
        {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-background/70">Loading YAML editor…</div>}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} disabled={busy} className={buttonClass}>Cancel</button>}
        {mode === 'edit' && <button type="button" onClick={discard} disabled={loading || busy || !dirty} className={buttonClass}>Discard</button>}
        <button type="button" onClick={() => { void submit() }} disabled={loading || busy || !editorRef.current || empty || !!syntaxError || (mode === 'edit' && !dirty)} className={buttonClass}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
