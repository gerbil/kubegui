export type AISettings = {
  enabled: boolean
  provider: string
  model: string
  endpoint: string
  token: string
}

export type AIAssistRequest = {
  task: 'auto_detect' | 'explain_event' | 'suggest_fix' | 'generate_yaml' | 'explain_logs'
  resource?: string
  namespace?: string
  name?: string
  message: string
  details?: string
}

export type AIAssistResponse = {
  suggestion: string
  provider: string
  model: string
}

async function readJSON<T>(response: Response, fallbackMessage: string): Promise<T> {
  const raw = await response.text()
  if (!raw.trim()) {
    throw new Error(fallbackMessage)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`${fallbackMessage}: ${raw.slice(0, 200)}`)
  }
}

export async function getAISettings(): Promise<AISettings> {
  const response = await fetch('/api/v1/ai/settings', { method: 'GET' })
  const payload = await readJSON<AISettings & { error?: string }>(response, 'failed to load AI settings response')
  if (!response.ok) {
    throw new Error(payload.error || 'failed to load AI settings')
  }
  return payload
}

export async function updateAISettings(input: AISettings): Promise<AISettings> {
  const response = await fetch('/api/v1/ai/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await readJSON<AISettings & { error?: string }>(response, 'failed to save AI settings response')
  if (!response.ok) {
    throw new Error(payload.error || 'failed to save AI settings')
  }
  return payload
}

export async function requestAIAssist(input: AIAssistRequest): Promise<AIAssistResponse> {
  const response = await fetch('/api/v1/ai/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await readJSON<AIAssistResponse & { error?: string }>(response, 'failed to get AI suggestion response')
  if (!response.ok) {
    throw new Error(payload.error || 'failed to get AI suggestion')
  }
  return payload
}

