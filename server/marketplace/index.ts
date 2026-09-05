import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createMarketplaceService } from './service'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing server environment: ${name}`)
  return value
}
const publicUrl = required('MARKETPLACE_PUBLIC_URL').replace(/\/$/, '')
const service = createMarketplaceService({
  supabaseUrl: required('SUPABASE_URL'),
  publishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  publicUrl,
})
const server = createServer(async (incoming, outgoing) => {
  try {
    const method = incoming.method ?? 'GET'
    const headers = new Headers()
    for (const [key, value] of Object.entries(incoming.headers))
      if (value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    const request = new Request(new URL(incoming.url ?? '/', publicUrl), {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD'
        ? {}
        : { body: Readable.toWeb(incoming), duplex: 'half' }),
    } as RequestInit)
    const response = await service(request)
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json' })
    outgoing.end('{"error":"Internal server error"}')
  }
})
server.requestTimeout = 30_000
server.headersTimeout = 10_000
server.listen(
  Number(process.env['PORT'] ?? 4318),
  process.env['HOST'] ?? '127.0.0.1',
  () => console.info('Bandal marketplace listening'),
)
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.close())
