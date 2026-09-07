import {
  AppConfigGetActiveClusterInfo,
  AppGetStats,
  DBGetClusterConfigs,
  DeploymentRestart,
  DeploymentScale,
  EventsGetNamespace,
  EventsGetResource,
  LogsGetCluster,
  LogsGetDeployment,
  LogsGetPod,
  NodeCordon,
  NodeGetAllocation,
  NodeGetMetricsByNameFromDB,
  NodesGetMetrics,
  NodeUncordon,
  PodGetMetricsByNameFromDB,
  ResourceAdd,
  ResourceDelete,
  ResourceEdit,
  ResourceGetDetails,
  ResourceList,
} from '../../bindings/kubegui/services/backend'

type BridgeResponse = {
  status: number
  headers?: Record<string, string | undefined>
  body: string
}

type EventMap = Map<string, string>

type ResourceMetadata = {
  uid?: string
  name?: string
  namespace?: string
}

type ResourceObject = {
  metadata?: ResourceMetadata
  [key: string]: unknown
}

const BACKEND_HOSTS = new Set(['wails.localhost:9245'])
const BACKEND_PATH_PREFIXES = ['/api/v1/', '/resource/', '/config', '/configs']
export const CLUSTER_CONNECTION_LOST_EVENT = 'kubegui:cluster-connection-lost'

const CLUSTER_FAILURE_THRESHOLD = 3
let consecutiveClusterFailures = 0
let clusterFailureEventSent = false

function hasWailsBridge(): boolean {
  return typeof window !== 'undefined' && ('__wails' in window || '_wails' in window)
}

function normalizeUrl(raw: string): URL {
  return new URL(raw, window.location.origin)
}

function normalizeBackendUrl(raw: string): string | null {
  try {
    const url = normalizeUrl(raw)
    // Keep Wails runtime static assets on the frontend host path.
    if (url.pathname.startsWith('/wails/')) return null
    const isKnownBackendHost = BACKEND_HOSTS.has(url.host)
    const isBackendPath = BACKEND_PATH_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))
    if (!isKnownBackendHost && !isBackendPath) return null
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

function isBackendUrl(raw: string): boolean {
  return normalizeBackendUrl(raw) !== null
}

function isClusterHealthTrackedUrl(raw: string): boolean {
  const normalized = normalizeBackendUrl(raw)
  if (!normalized) return false
  if (normalized === '/configs' || normalized === '/config' || normalized === '/api/v1/config' || normalized === '/api/v1/navigation') {
    return false
  }
  return true
}

function resetClusterFailureTracker() {
  consecutiveClusterFailures = 0
  clusterFailureEventSent = false
}

function noteClusterFailure(url: string, status: number, message: string) {
  if (!isClusterHealthTrackedUrl(url)) return
  if (status < 500) return
  consecutiveClusterFailures += 1
  if (consecutiveClusterFailures < CLUSTER_FAILURE_THRESHOLD || clusterFailureEventSent || typeof window === 'undefined') {
    return
  }
  clusterFailureEventSent = true
  window.dispatchEvent(new CustomEvent(CLUSTER_CONNECTION_LOST_EVENT, {
    detail: {
      status,
      message,
      url,
      failures: consecutiveClusterFailures,
    },
  }))
}

function noteClusterSuccess(url: string) {
  if (!isClusterHealthTrackedUrl(url)) return
  resetClusterFailureTracker()
}

async function readBody(body: BodyInit | null | undefined): Promise<string> {
  if (!body) return ''
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof FormData) {
    const params = new URLSearchParams()
    body.forEach((value, key) => {
      params.append(key, typeof value === 'string' ? value : value.name)
    })
    return params.toString()
  }
  if (body instanceof Blob) return await body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  return String(body)
}

function jsonBridgeResponse(payload: unknown, status = 200): BridgeResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}


async function jsonFrom<T>(promise: Promise<T>, status = 200): Promise<BridgeResponse> {
  return jsonBridgeResponse(await promise, status)
}

async function okFrom(promise: Promise<void>): Promise<BridgeResponse> {
  await promise
  return jsonBridgeResponse({ ok: true })
}

function bridgeUnavailableResponse(url: string): Response {
  return new Response(
    JSON.stringify({
      error: 'Wails bridge unavailable',
      message: `Blocked backend request without Wails bridge: ${url}`,
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

function bridgeError(status: number, message: string): BridgeResponse {
  return jsonBridgeResponse({ error: message, message }, status)
}

function parsePathParts(pathname: string): string[] {
  return pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map((part) => decodeURIComponent(part))
}

type PathParams = string[]

function routeParams(path: string, prefix: string): PathParams | null {
  const parts = parsePathParts(path)
  const prefixParts = parsePathParts(prefix)

  if (parts.length < prefixParts.length) return null

  const matchesPrefix = prefixParts.every((part, index) => parts[index] === part)
  if (!matchesPrefix) return null

  return parts.slice(prefixParts.length)
}

function parseNamespaceNameRoute(path: string, prefix: string) {
  const params = routeParams(path, prefix)
  if (!params || params.length < 2) return null

  const [namespacePart, name] = params
  const namespace = namespacePart === '_' ? '' : namespacePart

  if (!name) return null

  return { namespace, name }
}

function parseLogsPodRoute(path: string) {
  const params = routeParams(path, '/resource/logs/pods')
  if (!params || params.length < 3) return null

  const [namespace, deployment, pod] = params
  if (!namespace || !deployment || !pod) return null

  return { namespace, deployment, pod }
}

function parseLogsDeploymentRoute(path: string) {
  const params = routeParams(path, '/resource/logs/deployments')
  if (!params || params.length < 2) return null

  const [namespace, deployment] = params
  if (!namespace || !deployment) return null

  return { namespace, deployment }
}

function parseResourceRoute(path: string, prefix: string) {
  const params = routeParams(path, prefix)
  if (!params || params.length < 1) return null

  const [resource] = params
  if (!resource) return null

  return { resource }
}

function parseResourceActionRoute(path: string, prefix: string) {
  const params = routeParams(path, prefix)
  if (!params || params.length < 3) return null

  const [resource, namespacePart, name] = params
  const namespace = namespacePart === '_' ? '' : namespacePart

  if (!resource || !name) return null

  return { resource, namespace, name }
}

function parseDeploymentActionRoute(path: string, prefix: string) {
  const params = routeParams(path, prefix)
  if (!params || params.length < 2) return null

  const [namespace, deployment] = params
  if (!namespace || !deployment) return null

  return { namespace, deployment }
}

function parseNodeNameRoute(path: string, prefix: string) {
  const params = routeParams(path, prefix)
  if (!params || params.length < 1) return null

  const [nodeName] = params
  if (!nodeName) return null

  return { nodeName }
}

async function callExplicitService(inputUrl: string, method: string, body: string): Promise<BridgeResponse> {
  const normalized = normalizeBackendUrl(inputUrl)
  if (!normalized) throw new Error(`Not a backend url: ${inputUrl}`)

  const parsed = new URL(normalized, 'http://wails.localhost:9245')
  const requestPath = parsed.pathname
  const query = parsed.searchParams
  const upperMethod = method.toUpperCase()

  switch (true) {
    case requestPath === '/configs':
      return jsonFrom(DBGetClusterConfigs())

    case requestPath === '/config' || requestPath === '/api/v1/config':
      return jsonFrom(AppConfigGetActiveClusterInfo())

    case requestPath === '/api/v1/app-stats' || requestPath === '/api/v1/stream/app-stats':
      return jsonFrom(AppGetStats())

    case requestPath === '/api/v1/cluster-logs' || requestPath === '/api/v1/stream/cluster-logs':
      return jsonFrom(LogsGetCluster(Number.parseInt(query.get('limit') ?? '0', 10) || 0))

    case requestPath.startsWith('/api/v1/namespace-events/') ||
    requestPath.startsWith('/api/v1/stream/namespace-events/'): {
      const params =
          routeParams(requestPath, '/api/v1/namespace-events') ??
          routeParams(requestPath, '/api/v1/stream/namespace-events')

      const namespace = params?.[0] ?? ''

      return jsonFrom(EventsGetNamespace(
          namespace,
          Number.parseInt(query.get('limit') ?? '0', 10) || 0,
      ))
    }

    case requestPath === '/resource/nodes/metrics/json' ||
    requestPath === '/api/v1/stream/node-metrics':
      return jsonFrom(NodesGetMetrics())

    case requestPath === '/resource/nodes/allocation/json' ||
    requestPath === '/resource/nodes/allocation' ||
    requestPath === '/api/v1/nodes/allocation' ||
    requestPath === '/api/v1/stream/node-allocation':
      return jsonFrom(NodeGetAllocation())

    case requestPath === '/api/v1/navigation':
      return jsonBridgeResponse([])

    case requestPath.startsWith('/api/v1/resources/'): {
      const route = parseResourceRoute(requestPath, '/api/v1/resources')
      if (!route) return bridgeError(400, 'invalid resource path')

      const { resource } = route

      if (resource === 'events' && query.get('pod')) {
        return jsonFrom(EventsGetResource(query.get('ns') ?? '', query.get('pod') ?? ''))
      }

      return jsonFrom(ResourceList(resource, query.get('ns') ?? ''))
    }

    case requestPath === '/api/v1/resources/namespaces':
      return jsonFrom(ResourceList('namespaces', query.get('ns') ?? ''))

    case requestPath === '/api/v1/resources/nodes':
      return jsonFrom(ResourceList('nodes', query.get('ns') ?? ''))

    case requestPath === '/api/v1/resources/pods':
      return jsonFrom(ResourceList('pods', query.get('ns') ?? ''))

    case requestPath === '/api/v1/resources/deployments':
      return jsonFrom(ResourceList('deployments', query.get('ns') ?? ''))

    case requestPath === '/api/v1/resources/events':
      return jsonFrom(EventsGetResource(query.get('ns') ?? '', query.get('pod') ?? ''))

    case requestPath.startsWith('/resource/details/'): {
      const route = parseResourceActionRoute(requestPath, '/resource/details')
      if (!route) return bridgeError(400, 'invalid details path')

      return jsonFrom(ResourceGetDetails(route.resource, route.namespace, route.name))
    }

    case requestPath.startsWith('/resource/delete/'): {
      if (upperMethod !== 'DELETE') return bridgeError(405, 'DELETE required')

      const route = parseResourceActionRoute(requestPath, '/resource/delete')
      if (!route) return bridgeError(400, 'invalid delete path')

      return okFrom(ResourceDelete(route.resource, route.namespace, route.name))
    }

    case requestPath.startsWith('/resource/edit/'): {
      if (upperMethod !== 'PATCH') return bridgeError(405, 'PATCH required')

      const route = parseResourceActionRoute(requestPath, '/resource/edit')
      if (!route) return bridgeError(400, 'invalid edit path')

      const form = new URLSearchParams(body)
      const patch = form.get('patch') ?? ''

      return jsonFrom(ResourceEdit(route.resource, route.namespace, route.name, patch))
    }

    case requestPath.startsWith('/resource/add/'): {
      if (upperMethod !== 'POST') return bridgeError(405, 'POST required')

      const route = parseResourceRoute(requestPath, '/resource/add')
      if (!route) return bridgeError(400, 'invalid add path')

      const form = new URLSearchParams(body)
      const object = form.get('object') ?? ''

      return jsonFrom(ResourceAdd(route.resource, object))
    }

    case requestPath.startsWith('/resource/restart/deployments/'): {
      const route = parseDeploymentActionRoute(requestPath, '/resource/restart/deployments')
      if (!route) return bridgeError(400, 'invalid restart path')

      return jsonFrom(DeploymentRestart(route.namespace, route.deployment))
    }

    case requestPath.startsWith('/resource/scale/'): {
      const route = parseDeploymentActionRoute(requestPath, '/resource/scale')
      if (!route) return bridgeError(400, 'invalid scale path')

      return jsonFrom(DeploymentScale(
          route.namespace,
          route.deployment,
          Number.parseInt(query.get('replicas') ?? '-1', 10),
      ))
    }

    case requestPath.startsWith('/resource/nodes/cordon/'): {
      const route = parseNodeNameRoute(requestPath, '/resource/nodes/cordon')
      if (!route) return bridgeError(400, 'invalid node path')

      return jsonFrom(NodeCordon(route.nodeName))
    }

    case requestPath.startsWith('/resource/nodes/uncordon/'): {
      const route = parseNodeNameRoute(requestPath, '/resource/nodes/uncordon')
      if (!route) return bridgeError(400, 'invalid node path')

      return jsonFrom(NodeUncordon(route.nodeName))
    }

    case requestPath.startsWith('/resource/nodes/drain/'):
      return bridgeError(501, 'node drain is not implemented via Wails bridge yet')

    case requestPath.startsWith('/resource/pod/metrics/'): {
      const route = parseNamespaceNameRoute(requestPath, '/resource/pod/metrics')
      if (!route) return jsonBridgeResponse({ data: [] })

      return jsonFrom(PodGetMetricsByNameFromDB(route.namespace, route.name))
    }

    case requestPath.startsWith('/resource/node/metrics/'): {
      const route = parseNodeNameRoute(requestPath, '/resource/node/metrics')
      if (!route) return jsonBridgeResponse({ data: [] })

      return jsonFrom(NodeGetMetricsByNameFromDB(route.nodeName))
    }

    case requestPath.startsWith('/resource/logs/pods/'): {
      const route = parseLogsPodRoute(requestPath)
      if (!route) return jsonBridgeResponse([])

      return {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: (await LogsGetPod(route.namespace, route.deployment, route.pod)).join('\n'),
      }
    }

    case requestPath.startsWith('/resource/logs/deployments/'): {
      const route = parseLogsDeploymentRoute(requestPath)
      if (!route) return jsonBridgeResponse([])

      return {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: (await LogsGetDeployment(route.namespace, route.deployment)).join('\n'),
      }
    }

    default:
      return bridgeError(501, `bridge route not implemented: ${upperMethod} ${requestPath}`)
  }
}

function responseHeaders(headers?: Record<string, string | undefined>) {
  const result = new Headers()
  Object.entries(headers ?? {}).forEach(([key, value]) => {
    if (value !== undefined) result.set(key, value)
  })
  if (!result.has('Content-Type')) {
    result.set('Content-Type', 'application/json')
  }
  return result
}

function resourceKey(item: ResourceObject): string {
  const meta = item.metadata ?? {}
  return String(meta.uid ?? `${meta.namespace ?? ''}/${meta.name ?? ''}`)
}

function dispatchCustom(target: BackendEventSource, type: string, data?: unknown) {
  const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data) })
  target.dispatchEvent(event)
  if (type === 'open') target.onopen?.(event)
  if (type === 'error') target.onerror?.(event)
  if (type === 'message') target.onmessage?.(event as MessageEvent)
}

function streamSnapshotUrl(raw: string): string {
  const normalized = normalizeBackendUrl(raw) ?? raw
  if (normalized.startsWith('/api/v1/resources/') && normalized.includes('/stream')) {
    return normalized.replace('/stream', '')
  }
  if (normalized.startsWith('/api/v1/stream/cluster-logs')) return normalized.replace('/api/v1/stream/cluster-logs', '/api/v1/cluster-logs')
  if (normalized.startsWith('/api/v1/stream/namespace-events/')) return normalized.replace('/api/v1/stream/', '/api/v1/')
  if (normalized.startsWith('/api/v1/stream/app-stats')) return normalized.replace('/api/v1/stream/app-stats', '/api/v1/app-stats')
  if (normalized.startsWith('/api/v1/stream/node-metrics')) return '/resource/nodes/metrics/json'
  if (normalized.startsWith('/api/v1/stream/node-allocation')) return '/resource/nodes/allocation/json'
  if (normalized === '/api/v1/nodes/allocation') return '/resource/nodes/allocation/json'
  if (normalized === '/resource/nodes/allocation') return '/resource/nodes/allocation/json'
  return normalized
}

export class BackendEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly url: string
  readonly withCredentials = false
  readyState = BackendEventSource.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  private delegate: EventSource | null = null
  private timer: number | null = null
  private disposed = false
  private initialized = false
  private previousItems: EventMap = new Map()
  private previousLines: string[] = []

  constructor(rawUrl: string | URL) {
    super()
    this.url = typeof rawUrl === 'string' ? rawUrl : rawUrl.toString()

    if (isBackendUrl(this.url) && !hasWailsBridge()) {
      this.readyState = BackendEventSource.CONNECTING
      queueMicrotask(() => {
        if (this.disposed) return
        dispatchCustom(this, 'error', `Blocked backend stream without Wails bridge: ${this.url}`)
      })
      return
    }

    if (!isBackendUrl(this.url)) {
      this.delegate = new EventSource(this.url)
      this.readyState = this.delegate.readyState
      this.forwardDelegateEvent('open')
      this.forwardDelegateEvent('error')
      this.forwardDelegateEvent('message')
      this.forwardDelegateEvent('connected')
      this.forwardDelegateEvent('snapshot')
      this.forwardDelegateEvent('update')
      this.forwardDelegateEvent('add')
      this.forwardDelegateEvent('delete')
      this.forwardDelegateEvent('log')
      this.forwardDelegateEvent('heartbeat')
      return
    }

    this.poll()
  }

  private forwardDelegateEvent(type: string) {
    this.delegate?.addEventListener(type, (event: Event) => {
      this.readyState = this.delegate?.readyState ?? BackendEventSource.CLOSED
      this.dispatchEvent(event)
      if (type === 'open') this.onopen?.(event)
      if (type === 'error') this.onerror?.(event)
      if (type === 'message') this.onmessage?.(event as MessageEvent)
    })
  }

  private scheduleNext(delayMs: number) {
    if (this.disposed) return
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => { void this.poll() }, delayMs)
  }

  private async poll() {
    if (this.disposed) return
    try {
      const response = await callExplicitService(streamSnapshotUrl(this.url), 'GET', '')
      if (response.status < 200 || response.status >= 300) {
        noteClusterFailure(this.url, response.status, `HTTP ${response.status}`)
        this.readyState = BackendEventSource.CONNECTING
        dispatchCustom(this, 'error', `HTTP ${response.status}`)
        this.scheduleNext(3000)
        return
      }
      noteClusterSuccess(this.url)
      this.readyState = BackendEventSource.OPEN
      if (!this.initialized) {
        this.initialized = true
        dispatchCustom(this, 'open')
      }
      const contentType = response.headers?.['Content-Type'] ?? response.headers?.['content-type'] ?? 'application/json'
      const payload = contentType.includes('json') && response.body ? JSON.parse(response.body) : response.body
      this.emitBackendEvents(payload)
      this.scheduleNext(this.url.includes('/resource/logs/') ? 2000 : 5000)
    } catch (error) {
      noteClusterFailure(this.url, 500, error instanceof Error ? error.message : 'bridge eventsource error')
      this.readyState = BackendEventSource.CONNECTING
      dispatchCustom(this, 'error', error instanceof Error ? error.message : 'bridge eventsource error')
      this.scheduleNext(3000)
    }
  }

  private emitBackendEvents(payload: unknown) {
    const normalized = normalizeBackendUrl(this.url) ?? this.url

    if (normalized.startsWith('/api/v1/resources/') && normalized.includes('/stream')) {
      if (!this.initialized) return
      const resource = normalized.split('/')[4] ?? 'resource'
      const items: ResourceObject[] = Array.isArray(payload)
        ? payload.filter((item): item is ResourceObject => Boolean(item) && typeof item === 'object')
        : (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).items)
              ? ((payload as Record<string, unknown>).items as unknown[]).filter(
                  (item): item is ResourceObject =>
                      Boolean(item) && typeof item === 'object'
              )
              : []);
      if (this.previousItems.size === 0) {
        dispatchCustom(this, 'connected')
      }
      const nextItems: EventMap = new Map()
      for (const item of items) {
        const key = resourceKey(item)
        const serialized = JSON.stringify(item)
        nextItems.set(key, serialized)
        const meta = item.metadata ?? {}
        const envelope = {
          resource,
          uid: meta.uid,
          name: meta.name,
          namespace: meta.namespace,
          item,
        }
        if (!this.previousItems.has(key)) {
          dispatchCustom(this, 'add', envelope)
        } else if (this.previousItems.get(key) !== serialized) {
          dispatchCustom(this, 'update', envelope)
        }
      }
      for (const [key, serialized] of this.previousItems.entries()) {
        if (nextItems.has(key)) continue
        const parsedPrevious = JSON.parse(serialized) as unknown
        const previous: ResourceObject = parsedPrevious && typeof parsedPrevious === 'object'
          ? (parsedPrevious as ResourceObject)
          : {}
        const meta = previous.metadata ?? {}
        dispatchCustom(this, 'delete', {
          resource,
          uid: meta.uid,
          name: meta.name,
          namespace: meta.namespace,
          item: previous,
        })
      }
      this.previousItems = nextItems
      return
    }

    if (normalized.startsWith('/resource/logs/')) {
      const lines = typeof payload === 'string'
        ? payload.split('\n')
        : Array.isArray(payload)
          ? payload.map((line) => String(line))
          : []
      const startIndex = lines.length >= this.previousLines.length && this.previousLines.every((value, index) => lines[index] === value)
        ? this.previousLines.length
        : 0
      for (const line of lines.slice(startIndex)) {
        dispatchCustom(this, 'log', line)
      }
      this.previousLines = lines
      return
    }

    if (!this.initialized) return
    if (Array.isArray(payload)) {
      if (this.previousItems.size === 0) {
        dispatchCustom(this, 'snapshot', payload)
      } else {
        dispatchCustom(this, 'update', { items: payload, timestamp: Date.now() })
      }
      this.previousItems = new Map([['snapshot', JSON.stringify(payload)]])
      dispatchCustom(this, 'heartbeat')
      return
    }

    const hasSnapshot = this.previousItems.has('snapshot')
    if (!hasSnapshot) {
      dispatchCustom(this, 'snapshot', payload)
    } else {
      dispatchCustom(this, 'update', payload)
    }
    this.previousItems.set('snapshot', JSON.stringify(payload ?? null))
    dispatchCustom(this, 'heartbeat')
  }

  close() {
    this.disposed = true
    this.readyState = BackendEventSource.CLOSED
    if (this.timer) window.clearTimeout(this.timer)
    this.timer = null
    this.delegate?.close()
    this.delegate = null
  }
}

// No global transport patching: callers explicitly use backendFetch/BackendEventSource.

export async function backendFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let resolvedUrl: string
  let method = init?.method ?? 'GET'
  let body: string

  if (input instanceof Request) {
    resolvedUrl = input.url
    method = init?.method ?? input.method
    body = await readBody(init?.body ?? (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' ? undefined : await input.clone().text()))
  } else {
    resolvedUrl = typeof input === 'string' ? input : input.toString()
    body = await readBody(init?.body)
  }

  if (isBackendUrl(resolvedUrl) && !hasWailsBridge()) {
    return bridgeUnavailableResponse(resolvedUrl)
  }

  if (!isBackendUrl(resolvedUrl)) {
    return window.fetch(input, init)
  }

  try {
    const response = await callExplicitService(resolvedUrl, method.toUpperCase(), body)
    if (response.status >= 200 && response.status < 300) {
      noteClusterSuccess(resolvedUrl)
    } else {
      noteClusterFailure(resolvedUrl, response.status, `HTTP ${response.status}`)
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(response.headers),
    })
  } catch (error) {
    noteClusterFailure(resolvedUrl, 500, error instanceof Error ? error.message : 'bridge fetch error')
    throw error
  }
}
