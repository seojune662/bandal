import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAccountDeletionService } from '../../../supabase/functions/_shared/account-delete/service'
const workdir = process.env.BANDAL_SYNC_ACCESS_TEST_DIR

describe.skipIf(!workdir)('account deletion: isolated real Auth, database and Storage', () => {
  let admin: SupabaseClient, api: string, key: string
  beforeAll(() => {
    if (!workdir || !basename(workdir).startsWith('bandal-sync-access-check-')) throw new Error('Dedicated test environment required')
    const runtime = JSON.parse(execFileSync(process.env.BANDAL_SUPABASE_CLI || 'supabase', ['status', '--workdir', workdir, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    if (runtime.API_URL !== 'http://127.0.0.1:56831') throw new Error('Loopback only')
    api = runtime.API_URL; key = runtime.ANON_KEY
    admin = createClient(api, runtime.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  })
  function sql(query: string) {
    const output = execFileSync(process.env.BANDAL_SUPABASE_CLI || 'supabase', ['db', 'query', '--local', '--workdir', workdir!, query, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (!/^[\s]*[\[{]/.test(output)) return []
    const parsed = JSON.parse(output); return (parsed.rows ?? parsed) as Record<string, unknown>[]
  }
  async function user() {
    const email = `delete-${crypto.randomUUID()}@example.test`, password = `T-${crypto.randomUUID()}!`
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (created.error) throw new Error('Local user create failed')
    const client = createClient(api, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const auth = await client.auth.signInWithPassword({ email, password }); if (auth.error) throw new Error('Local login failed')
    expect((await admin.from('bandal_sync_beta_access').insert({ user_id: created.data.user.id, expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'isolated deletion test' })).error).toBeNull()
    return { id: created.data.user.id, client, jwt: auth.data.session!.access_token }
  }
  it('freezes sync and even admin-created orphan uploads while preserving another user', async () => {
    const owner = await user(), other = await user(), path = owner.id + '/' + 'a'.repeat(64)
    expect((await admin.storage.from('bandal-assets').upload(path, new Uint8Array([1]))).error).toBeNull()
    expect((await admin.rpc('bandal_account_deletion_begin', { actor: owner.id })).error).toBeNull()
    expect((await owner.client.rpc('bandal_sync_status')).data.writeAllowed).toBe(false)
    expect((await admin.storage.from('bandal-assets').upload(owner.id + '/' + 'b'.repeat(64), new Uint8Array([1]))).error).toBeTruthy()
    expect((await admin.rpc('bandal_account_deletion_assets', { actor: owner.id })).data).toEqual([{ bucket_id: 'bandal-assets', name: path }])
    expect((await owner.client.rpc('bandal_account_deletion_assets', { actor: other.id })).error).toBeTruthy()
    expect((await admin.rpc('bandal_account_deletion_cleanup', { actor: owner.id })).error?.message).toBe('account_deletion_storage_pending')
    expect((await admin.storage.from('bandal-assets').upload(other.id + '/' + 'c'.repeat(64), new Uint8Array([2]))).error).toBeNull()
  })
  it('completes the endpoint using verified Auth claims and the real Storage API, retaining retired billing ownership', async () => {
    const owner = await user(), path = owner.id + '/' + 'd'.repeat(64)
    expect((await admin.storage.from('bandal-assets').upload(path, new Uint8Array([1, 2]))).error).toBeNull()
    const legacyBucket = 'legacy-' + crypto.randomUUID()
    expect((await admin.storage.createBucket(legacyBucket, { public: false })).error).toBeNull()
    expect((await admin.storage.from(legacyBucket).upload('orphan', new Uint8Array([3]))).error).toBeNull()
    sql(`update storage.objects set owner='${owner.id}',owner_id=null where bucket_id='${legacyBucket}' and name='orphan'`)
    const customerId = 'ctm_' + crypto.randomUUID().replaceAll('-', '').slice(0, 26)
    expect((await admin.from('paddle_billing_customers').insert({ environment: 'live', customer_id: customerId, user_id: owner.id })).error).toBeNull()
    const service = createAccountDeletionService(admin, null, '')
    const response = await service(new Request('https://test/account-delete', { method: 'POST', headers: { authorization: 'Bearer ' + owner.jwt }, body: JSON.stringify({ confirm: true }) }))
    expect(await response.json()).toEqual({ ok: true, appleRevocation: 'not_applicable' })
    expect((await admin.auth.admin.getUserById(owner.id)).error).toBeTruthy()
    expect((await admin.storage.from('bandal-assets').list(owner.id)).data).toEqual([])
    expect((await admin.storage.from(legacyBucket).list()).data).toEqual([])
    expect((await admin.from('paddle_billing_customers').select('user_id').eq('customer_id', customerId).single()).data?.user_id).toBeNull()
    expect((await admin.from('bandal_account_deletions').select('completed_at').eq('user_id', owner.id).single()).data?.completed_at).toBeTruthy()
  })
  it.skipIf(process.env.BANDAL_ACCOUNT_DELETE_FULL_SCHEMA !== '1')('deletes a social/whiteboard owner while preserving a remaining group member', async () => {
    const owner = await user(), other = await user()
    const group = await owner.client.rpc('create_group', { p_name: 'Deletion test', p_color: 'moon' })
    expect(group.error).toBeNull()
    const gid = typeof group.data === 'string' ? group.data : group.data.id
    const boardId = crypto.randomUUID()
    sql(`do $$ begin insert into public.group_members(group_id,user_id) values('${gid}','${other.id}');
      insert into public.whiteboards(id,group_id,title,created_by) values('${boardId}','${gid}','Shared board','${owner.id}');
      insert into public.whiteboard_shapes(id,board_id,author_id,kind,data_json,style_json) values('${crypto.randomUUID()}','${boardId}','${owner.id}','ink','{}','{}');
      insert into public.feedback(kind,body,user_id) values('bug','Private note','${owner.id}'); end $$`)
    const service = createAccountDeletionService(admin, null, '')
    const response = await service(new Request('https://test/account-delete', { method: 'POST', headers: { authorization: 'Bearer ' + owner.jwt }, body: JSON.stringify({ confirm: true }) }))
    expect(await response.json()).toEqual({ ok: true, appleRevocation: 'not_applicable' })
    expect(sql(`select owner_id from public.study_groups where id='${gid}'`)[0]?.owner_id).toBe(other.id)
    expect(sql(`select created_by from public.whiteboards where id='${boardId}'`)[0]?.created_by).toBeNull()
    expect(sql(`select id from public.whiteboard_shapes where author_id='${owner.id}'`)).toEqual([])
    expect(sql(`select id from public.profiles where id='${owner.id}'`)).toEqual([])
    expect((await admin.auth.admin.getUserById(other.id)).error).toBeNull()
  })
  it.skipIf(process.env.BANDAL_ACCOUNT_DELETE_FULL_SCHEMA !== '1')('blocks unsettled payouts before deletion and allows a seller with only completed history', async () => {
    const owner = await user()
    expect((await admin.from('study_market_sellers').insert({ user_id: owner.id, ref_id: crypto.randomUUID(), display_name: 'Private seller name', environment: 'test' })).error).toBeNull()
    const payout = await admin.from('study_market_payouts').insert({ seller_id: owner.id, amount: 1000, environment: 'test', run_date: '2026-10-01', status: 'requested' }).select('id').single()
    expect(payout.error).toBeNull()
    const blocked = await admin.rpc('bandal_account_deletion_begin', { actor: owner.id })
    expect(blocked.error).toBeNull()
    expect(blocked.data).toMatchObject({ started: false, pendingTransactions: { payouts: [{ status: 'requested', count: 1 }] } })
    expect((await admin.from('bandal_account_deletions').select('user_id').eq('user_id', owner.id)).data).toEqual([])
    expect((await admin.from('study_market_payouts').update({ status: 'completed' }).eq('id', payout.data!.id)).error).toBeNull()
    const service = createAccountDeletionService(admin, null, '')
    const response = await service(new Request('https://test/account-delete', { method: 'POST', headers: { authorization: 'Bearer ' + owner.jwt }, body: JSON.stringify({ confirm: true }) }))
    expect(await response.json()).toMatchObject({ ok: true })
    expect((await admin.from('study_market_sellers').select('display_name,status,held').eq('user_id', owner.id).single()).data).toEqual({ display_name: '삭제된 계정', status: 'deleted', held: true })
    expect((await admin.from('study_market_payouts').select('status').eq('id', payout.data!.id).single()).data?.status).toBe('completed')
  })

  it('retires a checkout paid after deletion and rejects cross-account adoption of its customer', async () => {
    const owner = await user(), other = await user()
    const checkout = async (id: string) => {
      const reserved = await admin.rpc('paddle_billing_reserve_checkout', { actor: id, plan_input: 'monthly', request_key: crypto.randomUUID(), env: 'live' })
      expect(reserved.error).toBeNull()
      const transaction = 'txn_' + crypto.randomUUID().replaceAll('-', '').slice(0, 26)
      expect((await admin.rpc('paddle_billing_bind_checkout', { checkout_input: reserved.data.id, transaction_input: transaction, env: 'live' })).error).toBeNull()
      return { ...reserved.data, transaction }
    }
    const retired = await checkout(owner.id), current = await checkout(other.id)
    const service = createAccountDeletionService(admin, null, '')
    expect((await service(new Request('https://test/account-delete', { method: 'POST', headers: { authorization: 'Bearer ' + owner.jwt }, body: JSON.stringify({ confirm: true }) }))).status).toBe(200)
    const customer = 'ctm_' + crypto.randomUUID().replaceAll('-', '').slice(0, 26)
    const event = (transaction: string) => admin.rpc('paddle_billing_apply_event', { env: 'live', event_input: crypto.randomUUID(), event_type_input: 'transaction.completed', occurred_input: new Date().toISOString(), hash_input: 'a'.repeat(64), subscription_input: { id: 'sub_' + crypto.randomUUID().replaceAll('-', '').slice(0, 26), customer_id: customer, price_id: retired.price_id }, payment_input: null, origin_transaction_input: transaction })
    const late = await event(retired.transaction)
    expect(late.error).toBeNull(); expect(late.data).toBe('ignored_deleted_account')
    expect((await admin.from('paddle_billing_customers').select('user_id').eq('customer_id', customer).single()).data?.user_id).toBeNull()
    expect((await event(current.transaction)).error?.message).toBe('account_deleted')
  })

})
