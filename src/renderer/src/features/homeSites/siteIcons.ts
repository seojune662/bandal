import { useEffect, useState } from 'react'
import { invoke } from '../../lib/ipc'

/**
 * Site icons, fetched from the site itself (never a third-party icon service),
 * as on iPad (NativeSiteIconCache): the touch icon first, then the favicon.
 * Main fetches through the browsing session and returns raster data URLs only;
 * the renderer keeps them for the session and in localStorage between runs.
 */
const STORE_KEY = 'bandal:site-icons:v1'
const MAX_STORED = 48
const icons = new Map<string, string | null>()
const loading = new Map<string, Promise<string | null>>()
const listeners = new Set<() => void>()

function readStored(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}
  } catch { return {} }
}
for (const [host, url] of Object.entries(readStored())) if (typeof url === 'string' && url.startsWith('data:image/')) icons.set(host, url)

function store(host: string, url: string): void {
  try {
    const stored = readStored()
    stored[host] = url
    const keys = Object.keys(stored)
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STORED))) delete stored[key]
    localStorage.setItem(STORE_KEY, JSON.stringify(stored))
  } catch { /* The in-memory copy still serves this run. */ }
}

function load(host: string): Promise<string | null> {
  const existing = loading.get(host)
  if (existing) return existing
  const promise = (async () => {
    for (const path of ['/apple-touch-icon.png', '/favicon.ico']) {
      try {
        const { dataUrl } = await invoke('browser:favicon', { url: `https://${host}${path}`, profileId: 'default' })
        if (dataUrl) { store(host, dataUrl); return dataUrl }
      } catch { /* Try the next candidate. */ }
    }
    return null
  })().then(url => { icons.set(host, url); listeners.forEach(listener => listener()); return url })
  loading.set(host, promise)
  return promise
}

export function useSiteIcon(host: string): string | null {
  const [, refresh] = useState(0)
  useEffect(() => {
    const listener = (): void => refresh(value => value + 1)
    listeners.add(listener)
    if (!icons.has(host) && host) void load(host)
    return () => { listeners.delete(listener) }
  }, [host])
  return icons.get(host) ?? null
}
