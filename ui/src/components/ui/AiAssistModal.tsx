import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, X } from 'lucide-react'
import { requestAIAssist, type AIAssistRequest } from '@/lib/aiAssistant'
import { uiNotify } from './UiNotify'

type Props = {
  open: boolean
  onClose: () => void
  request: AIAssistRequest | null
}

export function AiAssistModal({ open, onClose, request }: Props) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [providerLabel, setProviderLabel] = useState<string>('')
  const requestKey = useMemo(() => {
    if (!request) return ''
    return [request.task, request.resource, request.namespace, request.name, request.message, request.details].join('|')
  }, [request])

  useEffect(() => {
    if (!request) return
    setResult('')
    setProviderLabel('')
  }, [requestKey, request])

  useEffect(() => {
    if (!open || !request) return
    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const response = await requestAIAssist(request)
        if (cancelled) return
        setResult(response.suggestion)
        setProviderLabel(`${response.provider} • ${response.model}`)
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'AI request failed'
        uiNotify.error(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => { cancelled = true }
  }, [open, requestKey, request])

  const title = useMemo(() => {
    if (!request) return 'AI Assistant'
    switch (request.task) {
      case 'auto_detect': return 'AI suggestion'
      case 'explain_event': return 'Explain event'
      case 'generate_yaml': return 'Generate YAML fix'
      case 'explain_logs': return 'Explain logs'
      default: return 'Suggest fix'
    }
  }, [request])

  if (!open || !request) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[1300] bg-black/60" onClick={onClose} />
      <div className="fixed z-[1301] left-1/2 top-1/2 w-[92vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={16} className="text-violet-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              {providerLabel && <p className="text-[11px] text-muted-foreground">{providerLabel}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/60">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">

          {loading && (
            <div className="rounded border border-border/40 bg-accent/20 p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" />
              Detecting issue and generating suggestion...
            </div>
          )}

          {result && (
            <div className="rounded border border-border/40 bg-surface-container-high/20 p-3 max-h-[50vh] overflow-auto">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Suggestion</p>
              <pre className="whitespace-pre-wrap text-xs text-foreground/95 font-mono">{result}</pre>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border/60 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-sm border border-border text-muted-foreground hover:text-foreground transition-colors">Close</button>
        </div>
      </div>
    </>,
    document.body,
  )
}

