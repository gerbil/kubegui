import { Notyf as FallbackNotyf } from 'notyf'

type NotifyType = 'success' | 'error' | 'info' | 'warning' | 'danger'

declare global {
  interface Window {
    notification?: (type: string, text: string) => void
    __kubeguiNotificationBridgeInstalled?: boolean
  }
}

type NotifyRuntime = {
  success: (message: string) => unknown
  error: (message: string) => unknown
  open: (options: { type: NotifyType; message: string }) => unknown
  dismissAll: () => void
}

type NotyfCtor = new (opts: Record<string, unknown>) => NotifyRuntime

type NotyfWindow = Window & typeof globalThis & {
  Notyf?: NotyfCtor
}

const FALLBACK_NOTYF = new FallbackNotyf({
  duration: 10_000,
  dismissible: true,
  ripple: false,
  position: { x: 'right', y: 'bottom' },
  types: [
    { type: 'success', backgroundColor: '#20c997', icon: false },
    { type: 'error', backgroundColor: 'indianred', icon: false },
    { type: 'info', backgroundColor: '#009ef7', icon: false },
    { type: 'warning', backgroundColor: 'orange', icon: false },
    { type: 'danger', backgroundColor: '#d33', icon: false },
  ],
}) as NotifyRuntime

// Inject compact font-size override for all Notyf toasts

let runtimePromise: Promise<NotifyRuntime> | null = null
let resolvedRuntime: NotifyRuntime | null = null
const recentlyShown = new Map<string, number>()
const DEDUPE_WINDOW_MS = 1500

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve()
    }, { once: true })
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
    document.head.appendChild(script)
  })
}

async function getRuntime(): Promise<NotifyRuntime> {
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    try {
      const win = window as NotyfWindow
      if (!win.Notyf) {
        // v2 serves legacy vendor files under /assets, not /legacy.
        await loadScript('/assets/js/notyf.js')
      }

      if (!win.Notyf) {
        resolvedRuntime = FALLBACK_NOTYF
        return FALLBACK_NOTYF
      }

      const rt = new win.Notyf({
        duration: 10_000,
        dismissible: true,
        position: { x: 'right', y: 'bottom' },
        types: [
          { type: 'warning', background: 'orange', icon: false },
          { type: 'info', background: '#009ef7', icon: false },
          { type: 'error', background: 'indianred', icon: false },
          { type: 'success', background: '#20c997', icon: false },
          { type: 'danger', background: '#d33', icon: false },
        ],
      })
      resolvedRuntime = rt
      return rt
    } catch {
      resolvedRuntime = FALLBACK_NOTYF
      return FALLBACK_NOTYF
    }
  })()

  return runtimePromise
}

function showOnRuntime(runtime: NotifyRuntime, type: NotifyType, message: string) {
  if (type === 'success') {
    runtime.success(message)
    return
  }
  if (type === 'error') {
    runtime.error(message)
    return
  }
  runtime.open({ type, message })
}

function notify(type: NotifyType, message: string) {
  const now = Date.now()
  const dedupeKey = `${type}:${message}`
  const lastShownAt = recentlyShown.get(dedupeKey)
  if (lastShownAt && now - lastShownAt < DEDUPE_WINDOW_MS) {
    return
  }
  recentlyShown.set(dedupeKey, now)

  // Keep the dedupe map small during long sessions.
  if (recentlyShown.size > 200) {
    for (const [key, ts] of recentlyShown.entries()) {
      if (now - ts > DEDUPE_WINDOW_MS * 4) {
        recentlyShown.delete(key)
      }
    }
  }

  // If the runtime is already resolved (synchronously available), show immediately.
  if (resolvedRuntime) {
    showOnRuntime(resolvedRuntime, type, message)
    return
  }

  // If the async runtime (legacy notyf) isn't ready yet, show immediately via
  // the fallback so notifications are never delayed by script loading.
  if (!runtimePromise) {
    showOnRuntime(FALLBACK_NOTYF, type, message)
    // Still kick off the async load so future calls use the preferred runtime.
    void getRuntime()
    return
  }

  // Runtime is loading — show via fallback immediately AND via runtime when ready
  // (dedupe will suppress the duplicate on the runtime side).
  showOnRuntime(FALLBACK_NOTYF, type, message)
}

export const uiNotify = {
  success(message: string) {
    notify('success', message)
  },
  error(message: string) {
    notify('error', message)
  },
  info(message: string) {
    notify('info', message)
  },
  dismissAll() {
    void getRuntime().then((runtime) => runtime.dismissAll())
  },
}

function normalizeNotifyType(type: string): NotifyType {
  const raw = String(type || '').toLowerCase()
  if (raw === 'success' || raw === 'error' || raw === 'info' || raw === 'warning' || raw === 'danger') {
    return raw
  }
  if (raw === 'warn') return 'warning'
  if (raw === 'ok') return 'success'
  return 'info'
}

export function installNotificationBridge() {
  if (typeof window === 'undefined' || window.__kubeguiNotificationBridgeInstalled) return
  window.__kubeguiNotificationBridgeInstalled = true

  window.notification = (type: string, text: string) => {
    const normalizedType = normalizeNotifyType(type)
    const message = String(text ?? '').trim()
    if (!message) return
    notify(normalizedType, message)
  }
}