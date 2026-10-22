/**
 * Favicons, fetched in main and handed to the renderer as a data URL.
 *
 * The favicon feature was removed once already because the renderer CSP is
 * `img-src 'self' data: bandal-media:` and a remote icon URL is simply
 * blocked. Relaxing the CSP to let the renderer load arbitrary remote images
 * would be the wrong trade for a 16px decoration, so the fetch happens here,
 * through the browsing session (school portals often gate even their favicon
 * behind the login cookie), and only a `data:` URL crosses the boundary.
 *
 * SVG is deliberately NOT accepted: an SVG is a document that can carry
 * script, and a data-URL SVG would be rendered by the privileged renderer.
 */

import { session } from 'electron'
import { BROWSING_PARTITION } from './webviewPolicy'

/** A favicon is 16–64px; anything larger is not one. */
const MAX_BYTES = 100 * 1024

/** In-memory, per run. A favicon is not worth a file on disk. */
const MAX_CACHE_ENTRIES = 200
const FAILED_CACHE_MS = 30_000

/** Some sites serve ICO as octet-stream. Trust raster signatures, not MIME. */
function rasterType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buffer.length >= 6 && buffer.readUInt32LE(0) === 0x00010000 && buffer.readUInt16LE(4) > 0) return 'image/x-icon'
  return null
}

function rasterDataUrl(buffer: Buffer): string | null {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null
  const type = rasterType(buffer)
  return type ? `data:${type};base64,${buffer.toString('base64')}` : null
}

export interface FaviconDeps {
  fetch?: (url: string, options: { signal: AbortSignal }) => Promise<Response>
}

export function createFaviconFetcher(deps: FaviconDeps = {}) {
  const cache = new Map<string, { data: string | null; time: number }>()
  const doFetch =
    deps.fetch ??
    ((url: string, options: { signal: AbortSignal }) => session.fromPartition(BROWSING_PARTITION).fetch(url, options))

  return async function faviconFor(url: string): Promise<string | null> {
    const cached = cache.get(url)
    if (cached && (cached.data !== null || Date.now() - cached.time < FAILED_CACHE_MS)) return cached.data

    const result = await load(url)
    if (cache.size >= MAX_CACHE_ENTRIES) {
      // Cheap eviction: the oldest key, since Map preserves insertion order.
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(url, { data: result, time: Date.now() })
    return result
  }

  async function load(url: string): Promise<string | null> {
    // Inline raster icons are common in generated sites. Decode and validate
    // locally; never fetch file/blob URLs or forward SVG to the renderer.
    if (url.startsWith('data:')) {
      if (url.length > MAX_BYTES * 2) return null
      const data = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(url)
      return data ? rasterDataUrl(Buffer.from(data[1]!, 'base64')) : null
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

    try {
      const response = await doFetch(url, { signal: AbortSignal.timeout(5_000) })
      if (!response.ok) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      return rasterDataUrl(buffer)
    } catch {
      return null
    }
  }
}

/** Test seam: the cache is module state and outlives a single test. */
export function resetFaviconCacheForTests(): void {
  // Each fetcher owns its profile cache.
}
