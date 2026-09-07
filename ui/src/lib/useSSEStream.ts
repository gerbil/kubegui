/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react'
import { BackendEventSource } from './wailsBackendTransport'

export interface SSEStreamOptions {
  url: string
  onSnapshot?: (data: unknown) => void
  onUpdate?: (data: unknown) => void
  onHeartbeat?: () => void
  onError?: (err: Error) => void
  maxReconnectMs?: number
  initialDataFallback?: () => Promise<unknown>
  reconnectOnError?: boolean
}

interface ReconnectStrategy {
  attempt: number
  nextRetryMs: number
}

/**
 * Shared SSE stream client with exponential backoff, stale detection, and fallback polling.
 *
 * - Connects to SSE endpoint and handles events: snapshot, update, heartbeat
 * - Reconnects with exponential backoff (1s, 2s, 4s, ..., max)
 * - Falls back to GET if stream is stale (no message for timeout period)
 * - Keeps current data visible even during reconnects
 */
export function useSSEStream({
  url,
  onSnapshot,
  onUpdate,
  onHeartbeat,
  onError,
  maxReconnectMs = 60_000,
  initialDataFallback,
  reconnectOnError = true,
}: SSEStreamOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)

  const eventSourceRef = useRef<BackendEventSource | null>(null)
  const reconnectRef = useRef<ReconnectStrategy>({ attempt: 0, nextRetryMs: 1000 })
  const staleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressNextErrorRef = useRef(false)
  const disposedRef = useRef(false)
  const lastMessageTimeRef = useRef<number>(Date.now())

  const closeEventSource = (suppressError = false) => {
    const current = eventSourceRef.current
    if (!current) return
    if (suppressError) suppressNextErrorRef.current = true
    current.close()
    eventSourceRef.current = null
  }

  const scheduleReconnect = (reason = 'stream reconnect') => {
    if (disposedRef.current) return
    if (!reconnectOnError) {
      setError(reason)
      onError?.(new Error(reason))
      return
    }

    const delayMs = Math.min(reconnectRef.current.nextRetryMs, maxReconnectMs)
    reconnectRef.current.attempt += 1
    reconnectRef.current.nextRetryMs = delayMs * 2

    const jitterMs = Math.random() * 1000
    const totalDelayMs = delayMs + jitterMs
    console.log(`[useSSEStream] ${url} reconnecting in ${totalDelayMs.toFixed(0)}ms (attempt ${reconnectRef.current.attempt}) - ${reason}`)

    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    reconnectTimeoutRef.current = setTimeout(() => {
      if (disposedRef.current) return
      setupEventSource()
    }, totalDelayMs)
  }

  const resetStaleTimer = () => {
    if (staleTimeoutRef.current) clearTimeout(staleTimeoutRef.current)
    setIsStale(false)
    const STALE_TIMEOUT_MS = 30_000 // 30s with no message = stale
    staleTimeoutRef.current = setTimeout(() => {
      setIsStale(true)
      // Optionally trigger fallback fetch
      if (initialDataFallback) {
        void initialDataFallback().catch((e) => {
          console.warn('[useSSEStream] fallback fetch failed:', e)
        })
      }
    }, STALE_TIMEOUT_MS)
  }

  const setupEventSource = () => {
    try {
      if (disposedRef.current) return
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current)
      closeEventSource(true)
      const es = new BackendEventSource(url)
      let reconnectScheduled = false

      const scheduleReconnectOnce = (reason: string) => {
        if (reconnectScheduled || disposedRef.current) return
        reconnectScheduled = true
        closeEventSource(true)
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
        scheduleReconnect(reason)
      }

      es.onopen = () => {
        setIsConnected(true)
        setError(null)
        // A successful open means future failures are likely transient; reset backoff.
        reconnectRef.current = { attempt: 0, nextRetryMs: 1000 }
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current)
          connectTimeoutRef.current = null
        }
      }

      es.addEventListener('snapshot', (ev) => {
        try {
          const msg = ev as MessageEvent
          const data = JSON.parse(msg.data)
          onSnapshot?.(data)
          setError(null)
          setIsConnected(true)
          setIsLoading(false)
          lastMessageTimeRef.current = Date.now()
          resetStaleTimer()
          // Reset reconnect backoff on successful connection
          reconnectRef.current = { attempt: 0, nextRetryMs: 1000 }
        } catch (e) {
          console.warn('[useSSEStream] snapshot parse error:', e)
        }
      })

      es.addEventListener('update', (ev) => {
        try {
          const msg = ev as MessageEvent
          const data = JSON.parse(msg.data)
          onUpdate?.(data)
          lastMessageTimeRef.current = Date.now()
          resetStaleTimer()
        } catch (e) {
          console.warn('[useSSEStream] update parse error:', e)
        }
      })

      es.addEventListener('heartbeat', () => {
        onHeartbeat?.()
        lastMessageTimeRef.current = Date.now()
        resetStaleTimer()
      })

      es.onerror = (err) => {
        if (suppressNextErrorRef.current) {
          suppressNextErrorRef.current = false
          return
        }
        console.warn('[useSSEStream] EventSource error:', err)
        setIsConnected(false)
        scheduleReconnectOnce('EventSource error')
      }

      // Some browsers can stay in CONNECTING without firing onerror; force a retry.
      connectTimeoutRef.current = setTimeout(() => {
        if (es.readyState === BackendEventSource.CONNECTING) {
          console.warn(`[useSSEStream] ${url} connect timeout; forcing reconnect`)
          setIsConnected(false)
          scheduleReconnectOnce('connect timeout')
        }
      }, 8000)

      eventSourceRef.current = es
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'stream setup failed'
      setError(msg)
      onError?.(new Error(msg))
    }
  }

  useEffect(() => {
    disposedRef.current = false
    // Fetch initial data before connecting to stream
    const initalize = async () => {
      if (initialDataFallback) {
        try {
          const data = await initialDataFallback()
          onSnapshot?.(data)
          setError(null)
          setIsLoading(false)
        } catch (err) {
          console.warn('[useSSEStream] initial fetch failed:', err)
          setError(err instanceof Error ? err.message : 'initial fetch failed')
        }
      }
      setupEventSource()
    }

    void initalize()

    return () => {
      disposedRef.current = true
      closeEventSource(true)
      if (staleTimeoutRef.current) clearTimeout(staleTimeoutRef.current)
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current)
    }
  }, [url])

  return { isConnected, isLoading, error, isStale }
}
