export interface ResourceWithMetadata {
  metadata: {
    uid: string
    name: string
    namespace?: string
  }
}

export type ResourceStreamStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface ResourceStreamEnvelope<T> {
  event?: 'connected' | 'add' | 'update' | 'delete'
  resource: string
  namespace?: string
  uid?: string
  name?: string
  item?: T
}

export function buildResourceListUrl(resource: string, namespace: string) {
  const params = new URLSearchParams()
  if (namespace && namespace !== 'all') {
    params.set('ns', namespace)
  }

  const query = params.toString()
  return `/api/v1/resources/${resource}${query ? `?${query}` : ''}`
}

export function buildResourceStreamUrl(resource: string, namespace: string) {
  const params = new URLSearchParams()
  if (namespace && namespace !== 'all') {
    params.set('ns', namespace)
  }

  const query = params.toString()
  return `/api/v1/resources/${resource}/stream${query ? `?${query}` : ''}`
}

export function parseResourceStreamEnvelope<T>(event: MessageEvent) {
  return JSON.parse(event.data) as ResourceStreamEnvelope<T>
}

export function upsertResourceByUid<T extends ResourceWithMetadata>(items: T[], nextItem: T) {
  const nextUid = nextItem.metadata.uid
  const existingIndex = items.findIndex((item) => item.metadata.uid === nextUid)

  if (existingIndex === -1) {
    return [...items, nextItem]
  }

  const nextItems = [...items]
  nextItems[existingIndex] = nextItem
  return nextItems
}

export function removeResourceByUid<T extends ResourceWithMetadata>(
  items: T[],
  envelope: Pick<ResourceStreamEnvelope<T>, 'uid' | 'item'>,
) {
  const targetUid = envelope.uid ?? envelope.item?.metadata.uid
  if (!targetUid) {
    return items
  }

  return items.filter((item) => item.metadata.uid !== targetUid)
}