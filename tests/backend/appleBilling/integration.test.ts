import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
const workdir = process.env.BANDAL_SYNC_ACCESS_TEST_DIR
const at = (days: number) => new Date(Date.now() + days * 86400000).toISOString()
const numberId = () => String(BigInt('0x' + crypto.randomUUID().replaceAll('-', '')))
const hash = 'a'.repeat(64)

describe.skipIf(!workdir)('Apple and Paddle common access: isolated real Postgres/Auth', () => {
  let admin: SupabaseClient, api: string, key: string, previousEnforcement: boolean
  beforeAll(async () => {
    if (!workdir || !basename(workdir).startsWith('bandal-sync-access-check-')) throw new Error('Dedicated test environment required')
    const runtime = JSON.parse(execFileSync(process.env.BANDAL_SUPABASE_CLI || 'supabase', ['status','--workdir',workdir,'--output','json'], {encoding:'utf8',stdio:['ignore','pipe','ignore']}))
    if (runtime.API_URL !== 'http://127.0.0.1:56831') throw new Error('Loopback test environment required')
    api=runtime.API_URL;key=runtime.ANON_KEY
    admin=createClient(api,runtime.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
    previousEnforcement=(await admin.from('bandal_sync_configuration').select('enforce_paid_access').single()).data!.enforce_paid_access
    expect((await admin.from('bandal_sync_configuration').update({enforce_paid_access:true}).eq('singleton',true)).error).toBeNull()
  })
  afterAll(async()=>{ if(admin) await admin.from('bandal_sync_configuration').update({enforce_paid_access:previousEnforcement}).eq('singleton',true) })
  async function user() {
    const email=`apple-${crypto.randomUUID()}@example.test`,password=`T-${crypto.randomUUID()}!`
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw new Error('Test user creation failed')
    const client=createClient(api,key,{auth:{persistSession:false,autoRefreshToken:false}})
    if((await client.auth.signInWithPassword({email,password})).error)throw new Error('Test login failed')
    return {id:created.data.user.id,client}
  }
  async function prepare(actor:string,env='production') {
    const r=await admin.rpc('apple_billing_prepare',{actor,env});expect(r.error).toBeNull();return r.data as string
  }
  const snapshot=(token:string,extra:Record<string,unknown>={})=>({appAccountToken:token,originalTransactionId:numberId(),transactionId:numberId(),productId:'app.bandal.ipad.sync.monthly',plan:'monthly',status:1,purchasedAt:at(-1),expiresAt:at(29),graceExpiresAt:null,autoRenew:true,revokedAt:null,revocationType:null,revocationPercentage:null,signedAt:at(0),...extra})
  const apply=(actor:string|null,s:unknown,extra:Record<string,unknown>={})=>admin.rpc('apple_billing_apply',{actor,env:'production',event_input:`verify_${crypto.randomUUID()}`,hash_input:hash,snapshot:s,...extra})
  const common=(actor:string)=>admin.rpc('bandal_subscription_status_for',{actor})
  it('creates a stable token, grants one 5 GiB entitlement, and preserves the existing sync contract',async()=>{
    const owner=await user(),token=await prepare(owner.id)
    expect(await prepare(owner.id)).toBe(token)
    expect((await apply(owner.id,snapshot(token))).error).toBeNull()
    expect((await common(owner.id)).data).toMatchObject({active:true,duplicateSubscription:false,storageLimitBytes:5368709120,sources:[{provider:'apple',active:true,environment:'production',plan:'monthly'}]})
    expect((await owner.client.rpc('bandal_sync_status')).data).toMatchObject({writeAllowed:true,accessSource:'subscription',storageLimitBytes:5368709120})
    expect((await admin.rpc('apple_billing_prepare',{actor:owner.id,env:'production'})).error?.message).toBe('subscription_exists')
  })
  it('rejects cross-account restore and privileged calls, and keeps owner reads isolated',async()=>{
    const owner=await user(),other=await user(),token=await prepare(owner.id),s=snapshot(token)
    expect((await apply(other.id,s)).error?.message).toBe('purchase_owned_by_another_account')
    expect((await owner.client.rpc('apple_billing_apply',{actor:owner.id,env:'production',event_input:'forged',hash_input:hash,snapshot:s})).error).toBeTruthy()
    expect((await owner.client.rpc('bandal_subscription_status_for',{actor:other.id})).error).toBeTruthy()
    expect((await owner.client.from('apple_billing_accounts').select('*')).error).toBeTruthy()
    expect((await owner.client.rpc('bandal_subscription_status')).data.active).toBe(false)
  })
  it('never grants production cloud access from Sandbox purchases',async()=>{
    const owner=await user(),token=await prepare(owner.id,'sandbox')
    expect((await apply(owner.id,snapshot(token),{env:'sandbox'})).error).toBeNull()
    expect((await common(owner.id)).data.active).toBe(false)
    expect((await owner.client.rpc('bandal_sync_status')).data.writeAllowed).toBe(false)
  })
  it('deduplicates notifications, rejects changed payloads, and prevents stale refund reversal',async()=>{
    const owner=await user(),token=await prepare(owner.id),s=snapshot(token),event=crypto.randomUUID()
    expect((await apply(owner.id,s,{event_input:event})).data).toBe('applied')
    expect((await apply(owner.id,s,{event_input:event})).data).toBe('duplicate')
    expect((await apply(owner.id,s,{event_input:event,hash_input:'b'.repeat(64)})).error?.message).toBe('event_payload_mismatch')
    expect((await apply(null,{...s,status:5,revokedAt:at(0),signedAt:at(0.001),revocationType:'REFUND_FULL',revocationPercentage:100000})).error).toBeNull()
    expect((await common(owner.id)).data.active).toBe(false)
    expect((await apply(null,s)).error).toBeNull()
    expect((await common(owner.id)).data.active).toBe(false)
    expect((await apply(null,{...s,signedAt:at(0.002)})).error).toBeNull()
    expect((await common(owner.id)).data.active).toBe(true)
  })
  it('keeps cancellation paid-through, grants only confirmed grace, and denies retry/expiry',async()=>{
    const owner=await user(),token=await prepare(owner.id),s=snapshot(token,{autoRenew:false})
    expect((await apply(owner.id,s)).error).toBeNull()
    expect((await common(owner.id)).data).toMatchObject({active:true,sources:[{cancelAtPeriodEnd:true}]})
    for(const [status,days,grace,active] of [[2,-1,null,false],[3,-1,null,false],[4,-1,at(1),true],[4,-1,at(-1),false]] as const){
      const current=(await admin.from('apple_billing_subscriptions').select('signed_at').eq('original_transaction_id',s.originalTransactionId).single()).data!
      expect((await apply(owner.id,{...s,status,expiresAt:at(days),graceExpiresAt:grace,signedAt:new Date(Date.parse(current.signed_at)+1000).toISOString()})).error).toBeNull()
      expect((await common(owner.id)).data.active).toBe(active)
    }
  })
  it('blocks Paddle checkout for an Apple subscription and during an Apple purchase reservation',async()=>{
    const owner=await user(),token=await prepare(owner.id)
    const checkout=()=>admin.rpc('paddle_billing_reserve_checkout',{actor:owner.id,plan_input:'monthly',request_key:crypto.randomUUID(),env:'live'})
    expect((await checkout()).error?.message).toBe('checkout_in_progress')
    expect((await apply(owner.id,snapshot(token))).error).toBeNull()
    expect((await checkout()).error?.message).toBe('subscription_exists')
  })
  it('retains immutable ownership after account deletion and never transfers an old purchase',async()=>{
    const owner=await user(),other=await user(),token=await prepare(owner.id),s=snapshot(token)
    expect((await apply(owner.id,s)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(owner.id)).error).toBeNull()
    expect((await admin.from('apple_billing_accounts').select('user_id').eq('app_account_token',token).single()).data?.user_id).toBeNull()
    expect((await apply(other.id,{...s,signedAt:at(1)})).error?.message).toBe('account_deleted')
  })
})
