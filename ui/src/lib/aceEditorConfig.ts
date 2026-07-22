import { attachSimpleAceSearch } from './aceSearch'

type AceAnnotation = { row?: number; column?: number; text?: string; type?: string }

type AceSessionLike = {
  setMode?: (mode: string) => void
  setUseWrapMode?: (enabled: boolean) => void
  setTabSize?: (size: number) => void
  setUseSoftTabs?: (enabled: boolean) => void
  getAnnotations?: () => AceAnnotation[]
  setAnnotations?: (annotations: AceAnnotation[]) => void
  on?: (event: string, cb: () => void) => void
}

type AceEditorLike = {
  setOptions?: (options: Record<string, unknown>) => void
  setTheme?: (theme: string) => void
  setReadOnly?: (value: boolean) => void
  getSession?: () => AceSessionLike
  getValue?: () => string
}

type JsYamlWindow = {
  jsyaml?: { load: (s: string) => unknown }
}

type ConfigureAceYamlOptions = {
  readOnly?: boolean
  onValidationChange?: (hasError: boolean) => void
}

const GLOBAL_ACE_YAML_THEME = 'ace/theme/solarized_dark'
const GLOBAL_ACE_YAML_MODE = 'ace/mode/yaml'

export function configureAceYamlEditor(editor: unknown, options: ConfigureAceYamlOptions = {}) {
  const aceEditor = editor as AceEditorLike
  const readOnly = options.readOnly ?? false

  aceEditor.setOptions?.({
    showGutter: true,
    highlightGutterLine: true,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    theme: GLOBAL_ACE_YAML_THEME,
    mode: GLOBAL_ACE_YAML_MODE,
    wrap: true,
    showPrintMargin: false,
    tabSize: 2,
    useSoftTabs: true,
    useWorker: false,   // worker unreliable in Wails — inline validation below
    readOnly,
    highlightActiveLine: true,
    highlightSelectedWord: true,
  })

  aceEditor.setTheme?.(GLOBAL_ACE_YAML_THEME)
  aceEditor.setReadOnly?.(readOnly)

  const session = aceEditor.getSession?.()
  session?.setMode?.(GLOBAL_ACE_YAML_MODE)
  session?.setUseWrapMode?.(true)
  session?.setTabSize?.(2)
  session?.setUseSoftTabs?.(true)

  attachSimpleAceSearch(editor)

  // Inline YAML validation via js-yaml — works without WebWorkers (Wails compatible).
  // Debounced 300ms; sets gutter annotations + fires onValidationChange.
  let validateTimer: ReturnType<typeof setTimeout> | null = null
  const validate = () => {
    if (validateTimer !== null) clearTimeout(validateTimer)
    validateTimer = setTimeout(() => {
      validateTimer = null
      const value = aceEditor.getValue?.() ?? ''
      const jsyaml = (window as unknown as JsYamlWindow).jsyaml
      if (!jsyaml || !session) return
      try {
        jsyaml.load(value)
        session.setAnnotations?.([])
        options.onValidationChange?.(false)
      } catch (e) {
        const err = e as { mark?: { line?: number; column?: number }; reason?: string; message?: string }
        const row = err.mark?.line ?? 0
        const col = err.mark?.column ?? 0
        const text = err.reason ?? err.message ?? 'YAML syntax error'
        session.setAnnotations?.([{ row, column: col, text, type: 'error' }])
        options.onValidationChange?.(true)
      }
    }, 300)
  }

  session?.on?.('change', validate)
}
