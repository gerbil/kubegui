import { attachSimpleAceSearch } from './aceSearch'

type AceAnnotation = { type?: string }

type AceSessionLike = {
  setMode?: (mode: string) => void
  setUseWrapMode?: (enabled: boolean) => void
  setTabSize?: (size: number) => void
  setUseSoftTabs?: (enabled: boolean) => void
  getAnnotations?: () => AceAnnotation[]
  on?: (event: string, cb: () => void) => void
}

type AceEditorLike = {
  setOptions?: (options: Record<string, unknown>) => void
  setTheme?: (theme: string) => void
  setReadOnly?: (value: boolean) => void
  getSession?: () => AceSessionLike
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
    useWorker: true,
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

  if (options.onValidationChange) {
    const syncValidation = () => {
      const annotations = session?.getAnnotations?.() ?? []
      options.onValidationChange?.(annotations.some((a) => a?.type === 'error'))
    }
    session?.on?.('changeAnnotation', syncValidation)
    syncValidation()
  }
}

