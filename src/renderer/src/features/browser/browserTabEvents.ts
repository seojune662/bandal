import type { DockviewApi } from 'dockview'

/** Native page input does not bubble through the workspace's DOM focus handler. */
export function focusVisibleBrowserPanel(api: DockviewApi | null, tabId: string): boolean {
  const panel = api?.panels.find(candidate => {
    const descriptor = candidate.params?.descriptor
    return descriptor?.kind === 'browser' && descriptor.payload?.tabId === tabId && candidate.api.isVisible
  })
  if (!panel) return false
  if (!panel.api.isActive) panel.api.setActive()
  return true
}

/** Navigation and newer icon events invalidate older asynchronous icon requests. */
export function createTabFaviconController(
  fetchIcon: (url: string) => Promise<string | null>,
  publish: (dataUrl: string | null) => void
): { navigation(url?: string): void; update(urls: readonly string[]): void; dispose(): void } {
  let revision = 0, disposed = false
  let defaultIcon: string | undefined
  const update = (urls: readonly string[]): void => {
    const request = ++revision
    const candidates = [...new Set([...urls].reverse().concat(defaultIcon ? [defaultIcon] : []))]
    void (async () => {
      for (const url of candidates) {
        if (disposed || request !== revision) return
        let data: string | null = null
        try { data = await fetchIcon(url) } catch { /* Try the next declared icon. */ }
        if (disposed || request !== revision) return
        if (data) { publish(data); return }
      }
      if (!disposed && request === revision) publish(null)
    })()
  }
  return {
    navigation(url) {
      revision++; publish(null)
      defaultIcon = undefined
      try {
        const page = new URL(url ?? '')
        if (page.protocol === 'http:' || page.protocol === 'https:') defaultIcon = new URL('/favicon.ico', page).href
      } catch { /* Internal pages have no site icon. */ }
      if (defaultIcon) update([])
    },
    update,
    dispose() { disposed = true; revision++ }
  }
}
