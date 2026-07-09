import { useEffect, useRef, useState } from 'react'
import { EventsGetNamespace, InformerSubscribeResource, InformerUnsubscribeResource } from '../../bindings/kubegui/services/backend'
import { Events } from '@wailsio/runtime'
import type { ResourceWithMetadata } from '../lib/resourceStream'
import { coalesce } from '../lib/coalesce'
import { wailsCall } from '../lib/wailsQueue'

export type SystemEvent = {
  time: string
  type: string
  reason: string
  object: string
  message: string
}

type K8sEvent = ResourceWithMetadata & {
  metadata: ResourceWithMetadata['metadata'] & { creationTimestamp?: string }
  eventTime?: string
  deprecatedLastTimestamp?: string
  lastTimestamp?: string
  firstTimestamp?: string
  series?: { lastObservedTime?: string }
  type?: string
  reason?: string
  note?: string
  message?: string
  regarding?: { kind?: string; name?: string }
  involvedObject?: { kind?: string; name?: string }
}

function eventTime(ev: K8sEvent) {
  return (
    ev.eventTime ||
    ev.deprecatedLastTimestamp ||
    ev.lastTimestamp ||
    ev.firstTimestamp ||
    ev.series?.lastObservedTime ||
    ev.metadata?.creationTimestamp ||
    new Date(0).toISOString()
  )
}

/**
 * Loads a namespace event snapshot, then keeps it updated via SSE.
 * Source: /api/v1/stream/namespace-events (primary), /api/v1/namespace-events (fallback).
 */
export function useSystemEvents(namespace = 'kube-system', limit = 10) {
  const [items, setItems] = useState<K8sEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    let retryTimer: number | null = null

    // Subscribe so eventsInformerChanged fires when the cache populates.
    void InformerSubscribeResource('events').catch(() => {})

    const fetchEvents = async (attempt = 0) => {
      try {
        const raw = await wailsCall(() => EventsGetNamespace(namespace, Math.max(limit * 3, 30)))
        if (cancelledRef.current) return
        const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
        setItems(
          rows.map(
            (row) =>
              ({
                metadata: {
                  creationTimestamp: String(
                    row.time ??
                      row.eventTime ??
                      (row.metadata as Record<string, unknown> | undefined)
                        ?.creationTimestamp ??
                      new Date(0).toISOString()
                  ),
                },
                type: String(row.type ?? 'Normal'),
                reason: String(row.reason ?? 'Unknown'),
                note: String(row.note ?? row.message ?? ''),
                message: String(row.note ?? row.message ?? ''),
                regarding: (() => {
                  const re = row.regarding as Record<string, unknown> | undefined
                  const inv = row.involvedObject as Record<string, unknown> | undefined
                  return {
                    kind: String(re?.kind ?? inv?.kind ?? 'Object'),
                    name: String(re?.name ?? inv?.name ?? 'unknown'),
                  }
                })(),
              } as K8sEvent)
          )
        )
        setIsLoading(false)
        setError(null)
        // Retry quickly if empty — cache may still be warming up (max 5 × 10 s)
        if (rows.length === 0 && attempt < 5) {
          retryTimer = window.setTimeout(() => { void fetchEvents(attempt + 1) }, 10_000)
        }
      } catch (err) {
        if (!cancelledRef.current) {
          console.warn('[useSystemEvents] fetch error:', err)
          setError(err instanceof Error ? err.message : 'fetch error')
          setIsLoading(false)
          if (attempt < 5) {
            retryTimer = window.setTimeout(() => { void fetchEvents(attempt + 1) }, 10_000)
          }
        }
      }
    }

    void fetchEvents()
    const timer = setInterval(() => {
      void fetchEvents()
    }, 30_000)

    // Re-fetch immediately when caches become fully synced.
    // Events.On receives a WailsEvent wrapper — the actual payload is in ev.data.
    const offSynced = Events.On('informerProgress', (ev: unknown) => {
      const stage = (ev as { data?: { stage?: string } })?.data?.stage
      if (stage === 'synced') void fetchEvents(0)
    })

    // Refresh when the events informer cache changes (coalesced — initial sync
    // can emit hundreds of eventsInformerChanged in rapid succession).
    const triggerFetch = coalesce(() => { void fetchEvents(0) }, 500)
    const offEvents = Events.On('eventsInformerChanged', triggerFetch)

    return () => {
      cancelledRef.current = true
      clearInterval(timer)
      if (retryTimer) window.clearTimeout(retryTimer)
      triggerFetch.cancel()
      offSynced?.()
      offEvents?.()
      void InformerUnsubscribeResource('events').catch(() => {})
    }
  }, [namespace, limit])

  const events = [...items]
    .sort((a, b) => new Date(eventTime(b)).getTime() - new Date(eventTime(a)).getTime())
    .slice(0, limit)
    .map((ev) => {
      const kind = String(ev.regarding?.kind ?? ev.involvedObject?.kind ?? '').trim()
      const name = String(ev.regarding?.name ?? ev.involvedObject?.name ?? '').trim()
      const object = kind ? (name ? `${kind}/${name}` : kind) : name
      return {
        time: eventTime(ev),
        type: ev.type ?? 'Normal',
        reason: ev.reason ?? 'Unknown',
        object: object || '',
        message: ev.note ?? ev.message ?? '',
      }
    })

  return { events, isLoading, error }
}
