import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createMarketplaceClient,
  marketplaceUrl,
} from '../../../src/main/features/plugins/marketplaceClient'

afterEach(() => vi.unstubAllEnvs())
describe('marketplace client boundary', () => {
  test.each([
    'https://user:password@example.com',
    'http://example.com',
    'https://example.com/path',
    'https://example.com/?key=x',
  ])('rejects unsafe service configuration %s', (url) => {
    vi.stubEnv('BANDAL_MARKETPLACE_URL', url)
    expect(marketplaceUrl()).toBeNull()
  })
  test('permits only an HTTPS origin or explicit local loopback development', () => {
    vi.stubEnv('BANDAL_MARKETPLACE_URL', 'https://marketplace.example.com/')
    expect(marketplaceUrl()).toBe('https://marketplace.example.com')
    vi.stubEnv('BANDAL_MARKETPLACE_URL', 'http://127.0.0.1:4318')
    expect(marketplaceUrl()).toBe('http://127.0.0.1:4318')
  })
  test('unconfigured or signed-out dashboard does not require network access', async () => {
    const fetch = vi.fn()
    const client = createMarketplaceClient({
      getClient: () => null,
      fetch,
      url: () => null,
    })
    expect(await client.dashboard()).toMatchObject({
      configured: false,
      signedIn: false,
    })
    const configured = createMarketplaceClient({
      getClient: () => null,
      fetch,
      url: () => 'https://marketplace.example.com',
    })
    expect(await configured.dashboard()).toMatchObject({
      configured: true,
      signedIn: false,
    })
    await expect(configured.register('test', 'Test')).rejects.toThrow('Sign in')
    expect(fetch).not.toHaveBeenCalled()
  })
  test('uses the current session and refuses redirects when sending tokens', async () => {
    const fetch = vi.fn(async () => Response.json({}))
    const auth = {
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'test-token' } },
          error: null,
        }),
      },
    } as unknown as SupabaseClient
    const client = createMarketplaceClient({
      getClient: () => auth,
      fetch,
      url: () => 'https://marketplace.example.com',
    })
    await client.register('test', 'Test')
    expect(fetch).toHaveBeenCalledWith(
      'https://marketplace.example.com/publishers',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
    await client.release('00000000-0000-0000-0000-000000000001')
    expect(fetch.mock.calls[1]?.[1].headers).not.toHaveProperty('Authorization')
  })
})
