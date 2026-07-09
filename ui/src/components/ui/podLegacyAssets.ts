let legacyTerminalAssetsPromise: Promise<void> | null = null
let legacyEditorAssetsPromise: Promise<void> | null = null

function scriptUrlCandidates(src: string): string[] {
  return [src]
}

function loadLegacyScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const injected = document.querySelector(`script[data-legacy-src="${src}"]`) as HTMLScriptElement | null
    if (injected) {
      injected.dataset.loaded = 'true'
      resolve()
      return
    }

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

    const candidates = scriptUrlCandidates(src)
    let idx = 0

    const tryNext = () => {
      if (idx >= candidates.length) {
        reject(new Error(`Failed to load ${src}`))
        return
      }

      const script = document.createElement('script')
      script.dataset.legacySrc = src
      script.src = candidates[idx++]
      script.async = false
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true'
        resolve()
      }, { once: true })
      script.addEventListener('error', () => {
        script.remove()
        tryNext()
      }, { once: true })
      document.head.appendChild(script)
    }

    tryNext()
  })
}

export function ensureLegacyTerminalAssets() {
  if (legacyTerminalAssetsPromise) return legacyTerminalAssetsPromise

  legacyTerminalAssetsPromise = (async () => {
    const cssHref = '/assets/css/xterm.css'
    if (!document.querySelector(`link[href="${cssHref}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = cssHref
      document.head.appendChild(link)
    }

    await loadLegacyScript('/assets/js/jquery.js')
    await loadLegacyScript('/assets/js/xterm.js')
    await loadLegacyScript('/assets/js/xterm-addon-fit.js')
    await loadLegacyScript('/assets/js/xterm-addon-clipboard.js')
    await loadLegacyScript('/assets/js/xterm-global.js')
  })()

  return legacyTerminalAssetsPromise
}

export function ensureLegacyEditorAssets() {
  if (legacyEditorAssetsPromise) return legacyEditorAssetsPromise

  legacyEditorAssetsPromise = (async () => {
    await loadLegacyScript('/assets/js/ace.js')
    await loadLegacyScript('/assets/js/ace-ext-searchbox.js')
    await loadLegacyScript('/assets/js/ace-mode-yaml.js')
    await loadLegacyScript('/assets/js/theme-idle_fingers.js')
    await loadLegacyScript('/assets/js/js-yaml.js')
  })()

  return legacyEditorAssetsPromise
}

export function prewarmPodLegacyAssets() {
  if (typeof document === 'undefined') return
  void Promise.allSettled([
    ensureLegacyTerminalAssets(),
    ensureLegacyEditorAssets(),
  ])
}
