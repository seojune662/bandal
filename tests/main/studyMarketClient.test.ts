import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createStudyMarketClient } from '../../src/main/features/studyMarket/client'

const config = () => ({ url: 'https://example.supabase.co', publishableKey: 'public-key' })
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('study marketplace transport', () => {
  it('does not pretend trading is enabled when config or service is absent', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = createStudyMarketClient({ config: () => null, getClient: () => null, fetch })
    expect(await client.request('dashboard', {})).toMatchObject({ configured: false, tradingEnabled: false, purchases: [] })
    await expect(client.request('order', { listingId: 'one' })).rejects.toThrow('준비')
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    expect(await createStudyMarketClient({ config, getClient: () => null, fetch }).request('dashboard', {})).toMatchObject({ configured: false, tradingEnabled: false })
  })
  it('only forwards the declared app action vocabulary', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const client = createStudyMarketClient({ config, getClient: () => null, fetch })
    await expect(client.dispatch({ action: 'confirmPayment', input: {} } as never)).rejects.toThrow('지원하지')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps auth in the main request and rejects failed financial responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ error: '거래 준비 중' }, 503))
    const client = createStudyMarketClient({ config, getClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'private-session' } }, error: null }) } }) as never, fetch })
    await expect(client.request('order', { listingId: 'one' })).rejects.toThrow('거래 준비 중')
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer private-session', apikey: 'public-key' } })
  })
  it.each(['https://evil.example/storage/v1/object', 'https://example.supabase.co.evil.test/storage/v1/object', 'https://example.supabase.co:444/storage/v1/object', 'https://user@example.supabase.co/storage/v1/object', 'https://example.supabase.co/rest/v1/profiles'])('rejects arbitrary storage authority: %s', url => {
    const client = createStudyMarketClient({ config, getClient: () => null, fetch: vi.fn() })
    expect(() => client.trustedStorageUrl(url)).toThrow()
  })
  it('accepts only this project standard and direct storage host', () => {
    const client = createStudyMarketClient({ config, getClient: () => null, fetch: vi.fn() })
    expect(client.trustedStorageUrl('https://example.storage.supabase.co/storage/v1/upload/resumable/a')).toContain('.storage.supabase.co')
  })
  it('rejects checkout URLs outside the first-party payment page', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ status: 'pending', checkoutUrl: 'https://evil.test/checkout#token=x' }))
    const client = createStudyMarketClient({ config, getClient: () => null, fetch })
    await expect(client.checkout('one')).rejects.toThrow('주소')
  })
  it('recovers an acknowledged TUS chunk after the response is lost and finalizes once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'study-market-client-')); dirs.push(dir)
    const path = join(dir, 'note.md'); const bytes = Buffer.from('# snapshot')
    await writeFile(path, bytes)
    const location = 'https://example.storage.supabase.co/storage/v1/upload/resumable/file'
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') throw new Error('connection lost after commit')
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(bytes.length) } })
      if (init?.headers && 'Upload-Length' in init.headers) return new Response(null, { status: 201, headers: { Location: location } })
      const body = JSON.parse(String(init?.body))
      if (body.action === 'uploadGrant') return json({ token: 'upload-capability', bucket: 'staging', objectPath: 'version/file', resumableUrl: 'https://example.storage.supabase.co/storage/v1/upload/resumable' })
      if (body.action === 'finalizeFile') return json({ ok: true })
      throw new Error('Unexpected request')
    })
    const client = createStudyMarketClient({ config, getClient: () => null, fetch })
    await client.upload('version', { id: 'file', absolutePath: path, path: 'note.md', mime: 'text/markdown', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    expect(fetch.mock.calls.filter(([, init]) => String(init?.body).includes('finalizeFile'))).toHaveLength(1)
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
  })
})
