import { useEffect, useState } from 'react'
import type { AIAssistRequest } from '@/lib/aiAssistant'
import { AiAssistModal } from './AiAssistModal'
import { ASK_AI_ERROR_EVENT } from './UiNotify'

export function NotificationAiAssist() {
  const [request, setRequest] = useState<AIAssistRequest | null>(null)

  useEffect(() => {
    const onAskAI = (event: Event) => {
      const message = (event as CustomEvent<string>).detail
      setRequest({ task: 'explain_error', message })
    }
    window.addEventListener(ASK_AI_ERROR_EVENT, onAskAI)
    return () => window.removeEventListener(ASK_AI_ERROR_EVENT, onAskAI)
  }, [])

  return <AiAssistModal open={request !== null} request={request} onClose={() => setRequest(null)} />
}
