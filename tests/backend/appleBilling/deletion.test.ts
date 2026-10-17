import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAccountDeletionService } from '../../../supabase/functions/_shared/account-delete/service'
import { openToken, recentAuthentication, sealToken } from '../../../supabase/functions/_shared/account-delete/policy'
const actor = '4af3991a-9478-4d5e-a11e-7f57006c9963', key = btoa('k'.repeat(32))
const claims = () => ({ sub: actor, role: 'authenticated', session_id: 'a-session', amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) }] })
function fixture() {
  const state = { claims: claims(), credential: null as unknown, storage: [{ bucket_id: 'bandal-assets', name: actor + '/orphan' }], calls: [] as string[], removeFails: false, cleanupFails: false, apple: false }
  const chain = (table: string) => {
    const builder = { select: () => builder, eq: () => builder, update: () => { state.calls.push('update:' + table); return builder }, maybeSingle: async () => ({ data: state.credential, error: null }), then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }) }
    return builder
  }
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: actor, identities: state.apple ? [{ provider: 'apple', identity_data: { sub: 'apple-owner' } }] : [] } }, error: null }), getClaims: async () => ({ data: { claims: state.claims }, error: null }), admin: { deleteUser: vi.fn(async () => { state.calls.push('auth:delete'); return { error: null } }) } },
    from: chain, rpc: vi.fn(async (name: string) => { state.calls.push(name); return { data: name === 'bandal_account_deletion_assets' ? [...state.storage] : null, error: state.cleanupFails && name === 'bandal_account_deletion_cleanup' ? { message: 'sensitive database detail' } : null } }),
    storage: { from: () => ({ remove: async () => { state.calls.push('storage:remove'); if (state.removeFails) return { data: null, error: new Error('secret storage token') }; state.storage = []; return { data: [], error: null } } }) }
  }
  const apple = { exchange: vi.fn(async () => 'refresh-secret'), revoke: vi.fn(async () => { state.calls.push('apple:revoke') }) }
  const service = createAccountDeletionService(db as unknown as SupabaseClient, apple, key)
  const call = (body: unknown, headers = { authorization: 'Bearer valid' }) => service(new Request('https://test/account-delete', { method: 'POST', headers, body: JSON.stringify(body) }))
  return { state, db, apple, call }
}
describe('account deletion: authenticated resumable lifecycle', () => {
  it('requires actual recent authentication; refreshing or user metadata is insufficient', () => {
    expect(recentAuthentication(claims(), actor)).toBe(true)
    expect(recentAuthentication({ ...claims(), amr: [{ method: 'token_refresh', timestamp: Date.now() / 1000 }], iat: Date.now() / 1000 }, actor)).toBe(false)
    expect(recentAuthentication({ ...claims(), amr: [{ method: 'oauth', timestamp: Date.now() / 1000 - 601 }] }, actor)).toBe(false)
    expect(recentAuthentication({ ...claims(), sub: 'different' }, actor)).toBe(false)
  })
  it('requires exact confirmation and never accepts a supplied account', async () => {
    const f = fixture()
    expect((await f.call({ confirm: true, userId: actor })).status).toBe(400)
    expect((await f.call({ confirm: false })).status).toBe(400)
    expect(f.db.rpc).not.toHaveBeenCalled()
    f.state.claims.amr[0]!.timestamp -= 700
    expect((await f.call({ confirm: true })).status).toBe(401)
    expect(f.db.rpc).not.toHaveBeenCalled()
  })
  it('freezes writes, removes orphan bytes through Storage API, then cleans data and finally Auth', async () => {
    const f = fixture(), response = await f.call({ confirm: true })
    expect(await response.json()).toEqual({ ok: true, appleRevocation: 'not_applicable' })
    expect(f.state.calls.indexOf('bandal_account_deletion_begin')).toBeLessThan(f.state.calls.indexOf('storage:remove'))
    expect(f.state.calls.indexOf('storage:remove')).toBeLessThan(f.state.calls.indexOf('bandal_account_deletion_cleanup'))
    expect(f.state.calls.indexOf('bandal_account_deletion_cleanup')).toBeLessThan(f.state.calls.indexOf('auth:delete'))
  })
  it('keeps Auth after storage or cleanup failure and supports a subsequent retry', async () => {
    const f = fixture(); f.state.removeFails = true
    expect(await (await f.call({ confirm: true })).json()).toEqual({ error: 'account_deletion_unavailable' })
    expect(f.db.auth.admin.deleteUser).not.toHaveBeenCalled()
    f.state.removeFails = false; f.state.cleanupFails = true
    expect((await f.call({ confirm: true })).status).toBe(503)
    expect(f.db.auth.admin.deleteUser).not.toHaveBeenCalled()
    f.state.cleanupFails = false
    expect((await f.call({ confirm: true })).status).toBe(200)
  })
  it('encrypts refresh tokens with account-bound authenticated encryption', async () => {
    const sealed = await sealToken('a-secret', actor, key)
    expect(sealed.ciphertext).not.toContain('a-secret')
    expect(await openToken(sealed, actor, key)).toBe('a-secret')
    await expect(openToken(sealed, 'other-user', key)).rejects.toThrow()
    await expect(openToken(sealed, actor, btoa('x'.repeat(32)))).rejects.toThrow()
  })
  it('binds Apple code exchange to the verified provider subject and stores only encrypted tokens', async () => {
    const f = fixture(); f.state.apple = true
    expect(await (await f.call({ action: 'registerAppleAuthorization', authorizationCode: 'one-use-code' })).json()).toEqual({ ok: true })
    expect(f.apple.exchange).toHaveBeenCalledWith('one-use-code', 'apple-owner')
    const args = f.db.rpc.mock.calls.find(call => call[0] === 'bandal_apple_authorization_store')
    expect(JSON.stringify(args)).not.toContain('refresh-secret')
    expect(f.db.auth.admin.deleteUser).not.toHaveBeenCalled()
  })
  it('revokes stored Apple tokens before deletion and reports manual guidance only for tokenless identities', async () => {
    const f = fixture(); f.state.apple = true
    f.state.credential = { ...await sealToken('refresh-secret', actor, key), revoked_at: null }
    expect((await (await f.call({ confirm: true })).json()).appleRevocation).toBe('revoked')
    expect(f.apple.revoke).toHaveBeenCalledWith('refresh-secret')
    expect(f.state.calls.indexOf('apple:revoke')).toBeLessThan(f.state.calls.indexOf('auth:delete'))
    const legacy = fixture(); legacy.state.apple = true
    expect((await (await legacy.call({ confirm: true })).json()).appleRevocation).toBe('manual_required')
  })
  it('keeps the account resumable if Apple revocation fails', async () => {
    const f = fixture(); f.state.credential = { ...await sealToken('secret', actor, key), revoked_at: null }
    f.apple.revoke.mockRejectedValueOnce(new Error('provider secret'))
    expect(await (await f.call({ confirm: true })).json()).toEqual({ error: 'account_deletion_unavailable' })
    expect(f.db.auth.admin.deleteUser).not.toHaveBeenCalled()
  })
})
