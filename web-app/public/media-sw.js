/*
 * Serves `/app/media/<course>/<path>` to the real renderer (PDF.js, note images)
 * without putting files or Google tokens anywhere but the page's memory.
 *
 * The service worker holds no data. For each request it asks the page that
 * made it for the bytes (the page downloads them from Google Drive with its
 * own token) and returns them with `no-store`. Nothing goes into Cache
 * Storage or onto disk.
 */
const TIMEOUT_MS = 5 * 60_000

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()) })

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  const scope = new URL(self.registration.scope)
  const prefix = `${scope.pathname}media/`
  if (url.origin !== scope.origin || !url.pathname.startsWith(prefix) || event.request.method !== 'GET') return
  event.respondWith(serve(event, url.pathname.slice(prefix.length)))
})

async function windowFor(event) {
  const own = event.clientId ? await self.clients.get(event.clientId) : null
  if (own && own.type === 'window') return own
  // A dedicated worker (PDF.js) asked: its page is a window client under this scope.
  const windows = await self.clients.matchAll({ type: 'window' })
  return windows.find(client => client.focused) ?? windows[0] ?? null
}

async function serve(event, path) {
  const client = await windowFor(event)
  if (!client) return new Response('', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  const channel = new MessageChannel()
  const answer = new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ok: false, status: 504 }), TIMEOUT_MS)
    channel.port1.onmessage = message => { clearTimeout(timer); resolve(message.data) }
  })
  client.postMessage({ type: 'bandal-media', path }, [channel.port2])
  const result = await answer
  if (!result || result.ok !== true || !(result.bytes instanceof ArrayBuffer)) {
    return new Response('', { status: result && Number.isInteger(result.status) ? result.status : 502, headers: { 'Cache-Control': 'no-store' } })
  }
  return new Response(result.bytes, {
    status: 200,
    headers: { 'Content-Type': typeof result.type === 'string' ? result.type : 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  })
}
