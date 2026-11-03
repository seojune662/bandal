import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminService, parseRange } from '../../../supabase/functions/_shared/admin/service'

const actor = '4af3991a-9478-4d5e-a11e-7f57006c9963'
const range = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }

function fixture(options: { operator?: boolean; user?: boolean; overviewError?: string; auditFails?: boolean } = {}) {
  const inserts: unknown[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'bandal_admin_is_operator') return { data: options.operator ?? true, error: null }
    if (name === 'bandal_admin_overview') return options.overviewError ? { data: null, error: { message: options.overviewError } } : { data: { range: args, users: { total: 3 } }, error: null }
    return { data: null, error: { message: 'unexpected' } }
  })
  const db = {
    auth: { getUser: vi.fn(async () => options.user === false ? { data: { user: null }, error: { message: 'bad jwt' } } : { data: { user: { id: actor, email: 'op@bandal.io' } }, error: null }) },
    rpc,
    from: () => ({ insert: async (row: unknown) => { inserts.push(row); return { error: options.auditFails ? { message: 'db detail' } : null } } })
  }
  const service = createAdminService(db as unknown as SupabaseClient, { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', origins: ['https://bandal.io'] })
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

  it('accepts only bounded ranges', () => {
    const now = Date.parse('2026-11-03T00:00:00Z')
    expect(parseRange(range, now)).toEqual(range)
    expect(() => parseRange({ from: range.to, to: range.from }, now)).toThrow('invalid_range')
    expect(() => parseRange({ from: '2026-01-01T00:00:00Z', to: '2027-01-03T00:00:00Z' }, Date.parse('2027-01-03T00:00:00Z'))).toThrow('invalid_range')
    expect(() => parseRange({ from: '2026-10-01', to: '2026-12-01' }, now)).toThrow('invalid_range')
    expect(() => parseRange({ from: 'yesterday', to: 'today' }, now)).toThrow('invalid_range')
  })
})
