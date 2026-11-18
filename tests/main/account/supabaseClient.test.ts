import { expect, test } from 'vitest'
import { createSupabaseClient, desktopUserAgent } from '../../../src/main/features/account/supabaseClient'

const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

test('the desktop app names itself and its version to the Bandal server, so the admin page can read it from Auth sessions', async () => {
  expect(desktopUserAgent('0.98.1', 'darwin', 'arm64')).toBe('Bandal-Desktop/0.98.1 (darwin arm64)')
  const requests: Headers[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Headers(init?.headers))
    return new Response(JSON.stringify({ msg: 'no' }), { status: 400, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    const client = createSupabaseClient({ storage, config: { url: 'https://example.invalid', publishableKey: 'sb_publishable_test' }, userAgent: desktopUserAgent('0.98.1', 'darwin', 'arm64') })
    await client!.auth.refreshSession({ refresh_token: 'fixture' }).catch(() => {})
  } finally {
    globalThis.fetch = original
  }
  expect(requests.length).toBeGreaterThan(0)
  expect(requests[0]!.get('user-agent')).toBe('Bandal-Desktop/0.98.1 (darwin arm64)')
  expect(requests[0]!.get('x-bandal-client')).toBe('desktop')
})
