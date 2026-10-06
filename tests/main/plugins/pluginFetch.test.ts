import { beforeEach, expect, test, vi } from 'vitest'
const electron = vi.hoisted(() => ({ net: { fetch: vi.fn() } }))
vi.mock('electron', () => electron)
import { createPluginApi, type PluginApiDeps } from '../../../src/main/features/plugins/pluginApi'

function fixture() {
  const networkAllowed = vi.fn((_id: string, url: string) => ['https://first.test', 'https://second.test'].includes(new URL(url).origin))
  const api = createPluginApi({ networkAllowed } as unknown as PluginApiDeps)
  return { request: (url: string, options?: unknown) => api['net.fetch']('test-plugin', url, options), networkAllowed }
}

beforeEach(() => { vi.clearAllMocks() })

test('cross-origin redirects recheck permissions and never forward authorization', async () => {
  const { request, networkAllowed } = fixture()
  electron.net.fetch.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://second.test/next' } }))
    .mockResolvedValueOnce(new Response('ok'))
  await request('https://first.test/start', { headers: { Authorization: 'Bearer private', Accept: 'text/plain' } })
  expect(networkAllowed.mock.calls.map(([, url]) => url)).toEqual(['https://first.test/start', 'https://second.test/next'])
  expect(electron.net.fetch.mock.calls[1]?.[1].headers).toEqual({ Accept: 'text/plain' })
})

test('303 switches POST to GET and removes its body and content headers', async () => {
  const { request } = fixture()
  electron.net.fetch.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: '/result' } }))
    .mockResolvedValueOnce(new Response('ok'))
  await request('https://first.test/start', { method: 'POST', body: 'value', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer private' } })
  const redirected = electron.net.fetch.mock.calls[1]?.[1]
  expect(redirected).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer private' } })
  expect(redirected).not.toHaveProperty('body')
  expect(redirected.headers).not.toHaveProperty('Content-Type')
})

test.each([302, 304])('returns HTTP %s without Location to the caller', async status => {
  const { request } = fixture()
  electron.net.fetch.mockResolvedValueOnce(new Response(null, { status }))
  await expect(request('https://first.test/start')).resolves.toMatchObject({ status, body: '' })
})

test('a redirect to an unapproved host never sends a request', async () => {
  const { request } = fixture()
  electron.net.fetch.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://denied.test' } }))
  await expect(request('https://first.test/start')).rejects.toThrow('not approved')
  expect(electron.net.fetch).toHaveBeenCalledOnce()
})
