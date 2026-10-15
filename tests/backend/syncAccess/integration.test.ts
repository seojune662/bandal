import { beforeAll, describe, expect, it } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const workdir=process.env.BANDAL_SYNC_ACCESS_TEST_DIR
const run=promisify(execFile)
const limit=5368709120, maxFile=536870912
const id=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll('-','').slice(0,26)}`
const at=(days:number)=>new Date(Date.now()+days*86400000).toISOString()
const quote=(value:string)=>`'${value.replaceAll("'","''")}'`
const operation=(record='note:test',revision=1,payload:unknown={text:'hello'},deleted=false)=>({
  id:crypto.randomUUID(),baseRevision:revision-1,
  record:{id:record,kind:'note',revision,formatVersion:1,deleted,payload:Buffer.from(JSON.stringify(payload)).toString('base64')}
})
const bytes=(op:ReturnType<typeof operation>)=>op.record.deleted?0:Buffer.from(op.record.payload,'base64').byteLength

describe.skipIf(!workdir)('paid personal sync, real Auth/Postgres/Storage boundaries',()=>{
  let admin:SupabaseClient, publicKey:string, api:string
  async function sql(query:string) {
    const result=await run(process.env.BANDAL_SUPABASE_CLI||'supabase',['db','query','--local','--workdir',workdir!,query,'--output','json'],{maxBuffer:2*1024*1024})
    if(!/^[\s]*[\[{]/.test(result.stdout))return []
    const parsed=JSON.parse(result.stdout)
    return (parsed.rows??parsed) as Record<string,unknown>[]
  }
  async function user(beta=false) {
    const email=`sync-${crypto.randomUUID()}@example.test`,password=`B-${crypto.randomUUID()}!`
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true})
    if(created.error||!created.data.user)throw new Error('Isolated sync user creation failed')
    const client=createClient(api,publicKey,{auth:{persistSession:false,autoRefreshToken:false}})
    if((await client.auth.signInWithPassword({email,password})).error)throw new Error('Isolated sync sign-in failed')
    const owner={id:created.data.user.id,client}
    if(beta)expect((await admin.from('bandal_sync_beta_access').insert({user_id:owner.id,reason:'local integration fixture',expires_at:at(1)})).error).toBeNull()
    return owner
  }
  async function status(owner:{client:SupabaseClient}) {
    const result=await owner.client.rpc('bandal_sync_status')
    expect(result.error).toBeNull(); return result.data
  }
  async function paid(owner:{id:string},environment='live') {
    let prices=await admin.from('paddle_billing_catalog').select('price_id').eq('environment',environment).eq('plan','monthly')
    if(!prices.data?.length){
      expect((await admin.from('paddle_billing_catalog').insert({environment,price_id:id('pri'),plan:'monthly',amount:4900})).error).toBeNull()
      prices=await admin.from('paddle_billing_catalog').select('price_id').eq('environment',environment).eq('plan','monthly')
    }
    const price=prices.data![0].price_id,customer=id('ctm'),subscription=id('sub'),transaction=id('txn')
    expect((await admin.from('paddle_billing_customers').insert({environment,customer_id:customer,user_id:owner.id})).error).toBeNull()
    expect((await admin.from('paddle_billing_subscriptions').insert({environment,subscription_id:subscription,customer_id:customer,user_id:owner.id,price_id:price,status:'active',period_starts_at:at(-1),period_ends_at:at(29)})).error).toBeNull()
    expect((await admin.from('paddle_billing_payments').insert({environment,transaction_id:transaction,subscription_id:subscription,customer_id:customer,user_id:owner.id,price_id:price,amount:4900,currency:'KRW',period_starts_at:at(-1),period_ends_at:at(29)})).error).toBeNull()
    return {subscription,transaction}
  }
  async function upload(owner:{id:string;client:SupabaseClient},data=Buffer.from(crypto.randomUUID())) {
    const hash=createHash('sha256').update(data).digest('hex')
    const result=await owner.client.storage.from('bandal-assets').upload(`${owner.id}/${hash}`,data,{contentType:'application/octet-stream',upsert:false})
    return {hash,result}
  }
  async function nearQuota(owner:{id:string},remaining:number) {
    // Metadata-only fixture in this disposable DB avoids allocating 5 GiB.
    // The competing final uploads below still use the real Storage HTTP API.
    const values=Array.from({length:10},(_,index)=>`('bandal-assets',${quote(`${owner.id}/${index.toString(16).padStart(64,'0')}`)},jsonb_build_object('size',${index===9?maxFile-remaining:maxFile}))`)
    await sql(`insert into storage.objects(bucket_id,name,metadata) values ${values.join(',')}`)
  }
  beforeAll(()=>{
    if(!workdir||!basename(workdir).startsWith('bandal-sync-access-check-'))throw new Error('Dedicated local sync runtime required')
    let runtime:Record<string,string>
    try{runtime=JSON.parse(execFileSync(process.env.BANDAL_SUPABASE_CLI||'supabase',['status','--workdir',workdir,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))}
    catch{throw new Error('Cannot read isolated sync runtime (credentials withheld)')}
    if(runtime.API_URL!=='http://127.0.0.1:56831')throw new Error('Only the dedicated loopback sync runtime is permitted')
    api=runtime.API_URL;publicKey=runtime.ANON_KEY!
    admin=createClient(api,runtime.SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  })

  it('starts with paid gating disabled, preserves writes, and tracks actual Storage bytes',async()=>{
    const owner=await user(),op=operation()
    expect(await status(owner)).toMatchObject({enforcePaidAccess:false,writeAllowed:true,accessSource:'rollout',storageUsedBytes:0})
    expect((await owner.client.rpc('bandal_push',{p_operation:op})).error).toBeNull()
    const data=Buffer.from('real storage probe and final commit'),file=await upload(owner,data)
    expect(file.result.error).toBeNull()
    expect((await upload(owner,data)).result.error).toBeTruthy()
    expect(await status(owner)).toMatchObject({recordBytes:bytes(op),assetBytes:data.length,usageComplete:true})
    expect((await admin.from('bandal_sync_configuration').update({enforce_paid_access:true}).eq('singleton',true)).error).toBeNull()
  })

  it('denies unpaid cloud writes and every privileged bypass, but keeps owner reads',async()=>{
    const owner=await user(),other=await user()
    expect(await status(owner)).toMatchObject({writeAllowed:false,accessSource:'none',storageLimitBytes:0})
    expect((await owner.client.rpc('bandal_push',{p_operation:operation()})).error?.message).toContain('sync_subscription_required')
    expect((await upload(owner)).result.error).toBeTruthy()
    expect((await owner.client.rpc('bandal_pull')).error).toBeNull()
    for(const name of ['bandal_sync_usage','bandal_sync_beta_access','bandal_sync_configuration']){
      expect((await owner.client.from(name).select('*')).error).toBeTruthy()
      expect((await owner.client.from(name).insert({user_id:other.id})).error).toBeTruthy()
    }
    expect((await owner.client.rpc('bandal_push_unmetered',{p_operation:operation()})).error).toBeTruthy()
    expect((await owner.client.rpc('bandal_sync_access_for',{actor:other.id})).error).toBeTruthy()
    expect((await owner.client.rpc('bandal_sync_status_for',{actor:other.id})).error).toBeTruthy()
    expect((await owner.client.rpc('bandal_sync_status_for',{actor:owner.id})).error).toBeTruthy()
    const privileged=await admin.rpc('bandal_sync_status_for',{actor:owner.id})
    expect(privileged.error).toBeNull();expect(privileged.data).toEqual(await status(owner))
    const anon=createClient(api,publicKey,{auth:{persistSession:false}})
    expect((await anon.rpc('bandal_sync_status')).error).toBeTruthy()
    expect((await anon.rpc('bandal_sync_status_for',{actor:owner.id})).error).toBeTruthy()
  })

  it('rejects Sandbox-only subscriptions and accepts current Live payments or explicit beta grants',async()=>{
    const sandbox=await user(),live=await user(),beta=await user(true)
    await paid(sandbox,'sandbox');await paid(live)
    expect(await status(sandbox)).toMatchObject({writeAllowed:false,accessSource:'none'})
    expect((await upload(sandbox)).result.error).toBeTruthy()
    expect(await status(live)).toMatchObject({writeAllowed:true,accessSource:'subscription',storageLimitBytes:limit})
    expect((await upload(live)).result.error).toBeNull()
    expect((await beta.client.rpc('bandal_push',{p_operation:operation()})).error).toBeNull()
    expect(await status(beta)).toMatchObject({writeAllowed:true,accessSource:'beta'})
  })

  it('revokes writes on expiry without hiding existing records or asset downloads',async()=>{
    const owner=await user(true),op=operation(),data=Buffer.from('keep readable after expiration')
    expect((await owner.client.rpc('bandal_push',{p_operation:op})).error).toBeNull()
    const saved=await upload(owner,data);expect(saved.result.error).toBeNull()
    expect((await admin.from('bandal_sync_beta_access').update({expires_at:at(-1)}).eq('user_id',owner.id)).error).toBeNull()
    expect((await owner.client.rpc('bandal_push',{p_operation:operation('new')})).error?.message).toContain('sync_subscription_required')
    expect((await upload(owner)).result.error).toBeTruthy()
    const pulled=await owner.client.rpc('bandal_pull');expect(pulled.error).toBeNull();expect(pulled.data.records).toHaveLength(1)
    const downloaded=await owner.client.storage.from('bandal-assets').download(`${owner.id}/${saved.hash}`)
    expect(downloaded.error).toBeNull();expect(Buffer.from(await downloaded.data!.arrayBuffer())).toEqual(data)
  })

  it('counts record replacements once, preserves idempotent retries, and releases tombstoned payloads',async()=>{
    const owner=await user(true),first=operation('note:replace',1,{text:'first payload'}),second=operation('note:replace',2,{text:'replacement'})
    expect((await owner.client.rpc('bandal_push',{p_operation:first})).error).toBeNull()
    expect((await owner.client.rpc('bandal_push',{p_operation:first})).error).toBeNull()
    expect(await status(owner)).toMatchObject({recordBytes:bytes(first)})
    expect((await owner.client.rpc('bandal_push',{p_operation:second})).error).toBeNull()
    expect(await status(owner)).toMatchObject({recordBytes:bytes(second)})
    expect((await owner.client.rpc('bandal_push',{p_operation:operation('note:replace',3,{},true)})).error).toBeNull()
    expect(await status(owner)).toMatchObject({recordBytes:0})
  })

  it('honors live paid-through and scheduled cancellation at the cloud write boundary',async()=>{
    const owner=await user(),subscription=await paid(owner)
    expect((await admin.from('paddle_billing_subscriptions').update({scheduled_action:'cancel',scheduled_at:at(29)}).eq('environment','live').eq('subscription_id',subscription.subscription)).error).toBeNull()
    expect((await upload(owner)).result.error).toBeNull()
    expect((await admin.from('paddle_billing_payments').update({period_starts_at:at(-31),period_ends_at:at(-1)}).eq('environment','live').eq('transaction_id',subscription.transaction)).error).toBeNull()
    expect(await status(owner)).toMatchObject({writeAllowed:false,accessSource:'none'})
    expect((await owner.client.rpc('bandal_push',{p_operation:operation()})).error?.message).toContain('sync_subscription_required')
    expect((await upload(owner)).result.error).toBeTruthy()
  })

  it('refuses rollout activation until previously unverified usage is reconciled',async()=>{
    const owner=await user(true),name=`${owner.id}/${'d'.repeat(64)}`
    expect((await admin.from('bandal_sync_configuration').update({enforce_paid_access:false}).eq('singleton',true)).error).toBeNull()
    await sql(`insert into storage.objects(bucket_id,name,metadata) values('bandal-assets',${quote(name)},null)`)
    expect(await status(owner)).toMatchObject({usageComplete:false})
    expect((await admin.from('bandal_sync_configuration').update({enforce_paid_access:true}).eq('singleton',true)).error?.message).toContain('sync_usage_reconciliation_required')
    await sql(`update storage.objects set metadata='{"size":123}' where bucket_id='bandal-assets' and name=${quote(name)}`)
    expect((await admin.from('bandal_sync_configuration').update({enforce_paid_access:true}).eq('singleton',true)).error).toBeNull()
    expect(await status(owner)).toMatchObject({usageComplete:true,assetBytes:123})
  })

  it('rejects unverified committed Storage sizes but permits rollback-only preflight probes',async()=>{
    const owner=await user(true),name=`${owner.id}/${'e'.repeat(64)}`
    await sql(`do $$ begin begin insert into storage.objects(bucket_id,name,metadata) values('bandal-assets',${quote(name)},'{"contentLength":123}'); raise exception 'probe rollback' using errcode='ZX001'; exception when sqlstate 'ZX001' then null; end; end $$`)
    expect(await status(owner)).toMatchObject({assetBytes:0,usageComplete:true})
    await expect(sql(`insert into storage.objects(bucket_id,name,metadata) values('bandal-assets',${quote(name)},'{"contentLength":123}')`)).rejects.toThrow()
    expect(await status(owner)).toMatchObject({assetBytes:0,usageComplete:true})
    await sql(`do $$ begin insert into storage.objects(bucket_id,name,metadata) values('bandal-assets',${quote(name)},null); update storage.objects set metadata='{"size":123}' where bucket_id='bandal-assets' and name=${quote(name)}; end $$`)
    expect(await status(owner)).toMatchObject({assetBytes:123,usageComplete:true})
    await sql(`update storage.objects set metadata='{"size":42}' where bucket_id='bandal-assets' and name=${quote(name)}`)
    expect(await status(owner)).toMatchObject({assetBytes:42})
    expect((await admin.storage.from('bandal-assets').remove([name])).error).toBeNull()
    expect(await status(owner)).toMatchObject({assetBytes:0})
  })

  it('atomically rejects one of two real Storage uploads that together exceed 5 GiB',async()=>{
    const owner=await user(true);await nearQuota(owner,300)
    const results=await Promise.all([upload(owner,Buffer.alloc(200,81)),upload(owner,Buffer.alloc(200,82))])
    expect(results.filter(item=>!item.result.error)).toHaveLength(1)
    expect(results.filter(item=>item.result.error)).toHaveLength(1)
    expect(results.find(item=>item.result.error)!.result.error!.message).toBe('sync_storage_quota_exceeded')
    expect(await status(owner)).toMatchObject({assetBytes:limit-100,storageUsedBytes:limit-100,usageComplete:true})
    expect((await sql(`select count(*)::integer as objects from storage.objects where bucket_id='bandal-assets' and name like ${quote(owner.id+'/%')}`))[0].objects).toBe(11)
  })

  it('combines records and assets in one quota and rolls back rejected operation receipts',async()=>{
    const owner=await user(true);await nearQuota(owner,20)
    const rejected=operation('note:too-large',1,{text:'this is more than twenty bytes'})
    expect((await owner.client.rpc('bandal_push',{p_operation:rejected})).error?.message).toContain('sync_storage_quota_exceeded')
    expect((await sql(`select count(*)::integer as operations from public.bandal_operations where user_id=${quote(owner.id)}`))[0].operations).toBe(0)
    expect(await status(owner)).toMatchObject({recordBytes:0,assetBytes:limit-20})
    const accepted=operation('note:small',1,{x:1});expect((await owner.client.rpc('bandal_push',{p_operation:accepted})).error).toBeNull()
    expect(await status(owner)).toMatchObject({recordBytes:bytes(accepted),storageUsedBytes:limit-20+bytes(accepted)})
  })
})
