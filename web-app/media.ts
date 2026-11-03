/**
 * The page side of `public/media-sw.js`: answers the service worker's requests
 * for material bytes. Registration waits until the worker controls this page,
 * so the renderer's first PDF request already goes through it.
 */
import { parseMediaPath } from './mediaUrl'

export type MediaResolver = (courseId: string, relPath: string) => Promise<{ bytes: Uint8Array; type: string }>

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', heic: 'image/heic', avif: 'image/avif', md: 'text/markdown; charset=utf-8'
}
export const mimeFor = (path: string): string => MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'

export async function installMediaBridge(resolve: MediaResolver): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('service_worker_unavailable')
  navigator.serviceWorker.addEventListener('message', event => {
    const port = event.ports[0]
    if (!port || event.data?.type !== 'bandal-media' || typeof event.data.path !== 'string') return
    const target = parseMediaPath(event.data.path)
    if (!target) { port.postMessage({ ok: false, status: 400 }); return }
    resolve(target.courseId, target.relPath).then(({ bytes, type }) => {
      // Copy out: the cached bytes stay in the page, and the copy is transferred.
      const buffer = bytes.slice().buffer
      port.postMessage({ ok: true, bytes: buffer, type }, [buffer])
    }, (error: unknown) => {
      port.postMessage({ ok: false, status: (error as { status?: number }).status === 401 ? 401 : 404 })
    })
  })
  const scope = import.meta.env.BASE_URL
  await navigator.serviceWorker.register(`${scope}media-sw.js`, { scope })
  await navigator.serviceWorker.ready
  if (navigator.serviceWorker.controller) return
  // First visit: the worker claims open pages when it activates.
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('service_worker_unavailable')), 10_000)
    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); done() }, { once: true })
  })
}
