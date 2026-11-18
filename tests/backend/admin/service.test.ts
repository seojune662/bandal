import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminService, parseRange } from '../../../supabase/functions/_shared/admin/service'

const actor = '4af3991a-9478-4d5e-a11e-7f57006c9963'
const range = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }

function fixture(options: { operator?: boolean; user?: boolean; overviewError?: string; auditFails?: boolean; insights?: boolean; lookupError?: string; secrets?: string[]; probe?: (name: string) => Promise<number> } = {}) {
  const inserts: unknown[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'bandal_admin_is_operator') return { data: options.operator ?? true, error: null }
    if (name === 'bandal_admin_overview') return options.overviewError ? { data: null, error: { message: options.overviewError } } : { data: { range: args, users: { total: 3 } }, error: null }
    if (name === 'bandal_admin_insights') return options.insights ? { data: { range: 'insights range', generatedAt: 'x', ai: { cost: 1530000 }, clients: { platforms: { ipad: 2 } }, health: { cron: [] } }, error: null } : { data: null, error: { message: 'function public.bandal_admin_insights does not exist' } }
    if (name === 'bandal_admin_lookup') return options.lookupError ? { data: null, error: { message: options.lookupError } } : { data: { matches: [{ id: 'u2' }], user: { id: 'u2', email: 'kim@example.invalid' }, target: 'u2' }, error: null }
    return { data: null, error: { message: 'unexpected' } }
  })
  const db = {
    auth: { getUser: vi.fn(async () => options.user === false ? { data: { user: null }, error: { message: 'bad jwt' } } : { data: { user: { id: actor, email: 'op@bandal.io' } }, error: null }) },
    rpc,
    from: () => ({ insert: async (row: unknown) => { inserts.push(row); return { error: options.auditFails ? { message: 'db detail' } : null } } })
  }
  const service = createAdminService(db as unknown as SupabaseClient, {
    supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', origins: ['https://bandal.io'],
    ...(options.secrets ? { hasSecret: (name: string) => options.secrets!.includes(name) } : {}),
    ...(options.probe ? { probe: options.probe } : {})
  })
  const call = (body: unknown, headers: Record<string, string> = { origin: 'https://bandal.io', authorization: 'Bearer token', 'content-type': 'application/json' }, method = 'POST') =>
    service(new Request('https://test/admin', { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }))
  return { call, rpc, db, inserts }
}

describe('admin dashboard API', () => {
  it('serves public sign-in config without a session, and only to bandal.io', async () => {
    const f = fixture()
    const ok = await f.call({ action: 'config' }, { origin: 'https://bandal.io', 'content-type': 'application/json' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon' })
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://bandal.io')
    const foreign = await f.call({ action: 'config' }, { origin: 'https://evil.example', 'content-type': 'application/json' })
    expect(foreign.status).toBe(403)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('requires a valid session, then an approved operator, before any aggregate runs', async () => {
    const anonymous = fixture()
    expect((await anonymous.call({ action: 'overview', ...range }, { origin: 'https://bandal.io', 'content-type': 'application/json' })).status).toBe(401)
    const badToken = fixture({ user: false })
    expect((await badToken.call({ action: 'overview', ...range })).status).toBe(401)
    const stranger = fixture({ operator: false })
    const denied = await stranger.call({ action: 'overview', ...range })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'admin_required' })
    expect(stranger.rpc).not.toHaveBeenCalledWith('bandal_admin_overview', expect.anything())
    expect(stranger.inserts).toEqual([])
  })

  it('returns the overview for an operator and audits the read', async () => {
    const f = fixture()
    const response = await f.call({ action: 'overview', ...range })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ users: { total: 3 } })
    expect(f.rpc).toHaveBeenCalledWith('bandal_admin_overview', { actor, from_input: range.from, to_input: range.to })
    expect(f.inserts).toEqual([{ actor, action: 'overview', range_from: range.from, range_to: range.to }])
  })

  it('withholds data when the audit cannot be written, and never leaks database detail', async () => {
    const f = fixture({ auditFails: true })
    const response = await f.call({ action: 'overview', ...range })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('db detail')
  })

  it('maps database refusals and rejects other methods and malformed bodies', async () => {
    expect((await fixture({ overviewError: 'admin_required' }).call({ action: 'overview', ...range })).status).toBe(403)
    expect((await fixture({ overviewError: 'secret detail' }).call({ action: 'overview', ...range })).status).toBe(503)
    expect((await fixture().call(null, { origin: 'https://bandal.io' }, 'GET')).status).toBe(405)
    expect((await fixture().call({ action: 'drop' })).status).toBe(400)
    expect((await fixture().call('x'.repeat(5000))).status).toBe(400)
  })

  it('adds AI, clients and server checks to the overview; an older database still answers', async () => {
    const probed: string[] = []
    const f = fixture({
      insights: true,
      secrets: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'APPLE_APP_ID'],
      probe: async name => { probed.push(name); if (name === 'schools') throw new Error('timeout'); return name === 'referral' ? 404 : name === 'ai-proxy' ? 503 : 204 }
    })
    const body = await (await f.call({ action: 'overview', ...range })).json()
    expect(body).toMatchObject({ users: { total: 3 }, ai: { cost: 1530000 }, clients: { platforms: { ipad: 2 } }, health: { cron: [] } })
    // The overview's own range stays; the insights' range and timestamp do not overwrite it.
    expect(body.range).toEqual({ actor, from_input: range.from, to_input: range.to })
    expect(body.server.secrets).toEqual([
      { feature: 'AI (iPad)', missing: [] },
      { feature: 'App Store (iPad)', missing: [] },
      { feature: 'Apple 로그인 탈퇴 연동', missing: ['APPLE_AUTH_TEAM_ID', 'APPLE_AUTH_KEY_ID', 'APPLE_AUTH_PRIVATE_KEY', 'APPLE_AUTH_TOKEN_ENCRYPTION_KEY'] }
    ])
    expect(JSON.stringify(body.server)).not.toMatch(/sk-|secret value/)
    expect(Object.fromEntries(body.server.functions.map((fn: { name: string; ok: boolean; status: number }) => [fn.name, [fn.ok, fn.status]]))).toEqual({
      'ai-proxy': [false, 503], 'ipad-store': [true, 204], 'ipad-store-notifications': [true, 204], 'account-delete': [true, 204], referral: [false, 404], schools: [false, 0]
    })
    expect(probed).toHaveLength(6)
    expect(f.rpc).toHaveBeenCalledWith('bandal_admin_insights', { actor, from_input: range.from, to_input: range.to })

    const older = await (await fixture().call({ action: 'overview', ...range })).json()
    expect(older).toMatchObject({ users: { total: 3 }, insightsError: true })
    expect(older.ai).toBeUndefined()
  })

  it('looks up a user for an operator only, audits who was shown, and bounds the query', async () => {
    const f = fixture()
    const response = await f.call({ action: 'lookup', query: '  kim  ' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ user: { id: 'u2' }, target: 'u2' })
    expect(f.rpc).toHaveBeenCalledWith('bandal_admin_lookup', { actor, query: 'kim' })
    expect(f.inserts).toEqual([{ actor, action: 'lookup', target: 'u2' }])

    const stranger = fixture({ operator: false })
    expect((await stranger.call({ action: 'lookup', query: 'kim' })).status).toBe(403)
    expect(stranger.rpc).not.toHaveBeenCalledWith('bandal_admin_lookup', expect.anything())
    for (const query of ['k', 'x'.repeat(255), 42, undefined]) {
      const bad = fixture()
      expect((await bad.call({ action: 'lookup', query })).status).toBe(400)
      expect(bad.rpc).not.toHaveBeenCalledWith('bandal_admin_lookup', expect.anything())
    }
    expect((await fixture({ lookupError: 'admin_invalid_query' }).call({ action: 'lookup', query: 'kim' })).status).toBe(400)
    const hidden = await fixture({ lookupError: 'relation detail' }).call({ action: 'lookup', query: 'kim' })
    expect(hidden.status).toBe(503)
    expect(await hidden.text()).not.toContain('relation detail')
    const unaudited = fixture({ auditFails: true })
    const withheld = await unaudited.call({ action: 'lookup', query: 'kim' })
    expect(withheld.status).toBe(503)
    expect(await withheld.text()).not.toContain('kim@example.invalid')
  })

  it('accepts only bounded ranges', () => {
    const now = Date.parse('2026-11-03T00:00:00Z')
    expect(parseRange(range, now)).toEqual(range)
    expect(() => parseRange({ from: range.to, to: range.from }, now)).toThrow('invalid_range')
    expect(() => parseRange({ from: '2026-01-01T00:00:00Z', to: '2027-01-03T00:00:00Z' }, Date.parse('2027-01-03T00:00:00Z'))).toThrow('invalid_range')
    expect(() => parseRange({ from: '2026-10-01', to: '2026-12-01' }, now)).toThrow('invalid_range')
    expect(() => parseRange({ from: 'yesterday', to: 'today' }, now)).toThrow('invalid_range')
  })
})
