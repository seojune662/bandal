import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAppleBillingService } from '../../../supabase/functions/_shared/apple-billing/service'
import { AppleBillingError, configured, snapshot, validateTransaction, type AppleConfig } from '../../../supabase/functions/_shared/apple-billing/policy'
import type { AppleProvider } from '../../../supabase/functions/_shared/apple-billing/provider'
const actor='11111111-1111-4111-8111-111111111111',accountToken='22222222-2222-4222-8222-222222222222'
const now=Date.now()
const config:AppleConfig={enabled:true,environment:'production',bundleId:'app.bandal.ipad',appAppleId:1234,issuerId:actor,keyId:'ABCDEFGHIJ',privateKey:'-----BEGIN PRIVATE KEY-----\nfixture',groupId:'123',productIds:{monthly:'app.bandal.ipad.sync.monthly',annual:'app.bandal.ipad.sync.yearly'},allowedUserIds:[actor],webOrigin:'https://bandal.io'}
const transaction=()=>({environment:'Production',bundleId:config.bundleId,type:'Auto-Renewable Subscription',subscriptionGroupIdentifier:'123',productId:config.productIds.monthly,inAppOwnershipType:'PURCHASED',quantity:1,appAccountToken:accountToken,transactionId:'12345',originalTransactionId:'123',purchaseDate:now-10000,expiresDate:now+100000,signedDate:now})
const renewal=()=>({environment:'Production',originalTransactionId:'123',productId:config.productIds.monthly,appAccountToken:accountToken,autoRenewStatus:1,signedDate:now})
function fixture(overrides:Partial<AppleConfig>={}){
 const rpc=vi.fn(async(name:string)=>({data:name==='apple_billing_prepare'?accountToken:name==='bandal_subscription_status_for'?{active:true,sources:[{provider:'apple'}]}:name==='bandal_sync_status_for'?{writeAllowed:true}:'applied',error:null}))
 const query:any={select:vi.fn(()=>query),eq:vi.fn(()=>query),maybeSingle:vi.fn(async()=>({data:{user_id:actor,app_account_token:accountToken},error:null})),limit:vi.fn(async()=>({data:[{original_transaction_id:'123'}],error:null}))}
 const getUser=vi.fn(async()=>({data:{user:{id:actor}},error:null}))
 const provider:AppleProvider={transaction:vi.fn(async()=>transaction()),notification:vi.fn(async()=>({notificationUUID:crypto.randomUUID(),notificationType:'DID_RENEW',data:{signedTransactionInfo:'signed'}})),current:vi.fn(async()=>snapshot(transaction(),renewal(),1,config))}
 const db={rpc,from:vi.fn(()=>query),auth:{getUser}} as unknown as SupabaseClient
 return {rpc,query,getUser,provider,handle:createAppleBillingService(db,{...config,...overrides},provider)}
}
const req=(input:unknown,auth=true,origin?:string)=>new Request('https://example.test/functions/v1/apple-billing',{method:'POST',headers:{...(auth?{authorization:'Bearer fixture'}:{}),...(origin?{origin}:{}),'content-type':'application/json'},body:JSON.stringify(input)})
describe('Apple purchase verification and account boundaries',()=>{
 it('fails closed until complete production configuration and rejects environment/token/product mismatch',()=>{
  expect(configured(config)).toBe(true)
  for(const change of [{appAppleId:0},{groupId:''},{privateKey:''},{bundleId:'other.app'}])expect(configured({...config,...change})).toBe(false)
  expect(()=>validateTransaction({...transaction(),environment:'Sandbox'},config)).toThrow('apple_environment_mismatch')
  for(const change of [{productId:'forged'},{bundleId:'other.app'},{inAppOwnershipType:'FAMILY_SHARED'},{quantity:2}])expect(()=>validateTransaction({...transaction(),...change},config)).toThrow('apple_product_mismatch')
  expect(()=>validateTransaction({...transaction(),appAccountToken:undefined},config)).toThrow('apple_account_token_required')
 })
 it('normalizes current expiry/grace/refund facts without client price or activation claims',()=>{
  expect(snapshot(transaction(),renewal(),1,config)).toMatchObject({status:1,plan:'monthly',autoRenew:true,revokedAt:null})
  expect(()=>snapshot(transaction(),renewal(),4,config)).toThrow('invalid_apple_data')
  expect(snapshot({...transaction(),revocationDate:now,revocationType:'REFUND_PRORATED',revocationPercentage:50000},renewal(),5,config)).toMatchObject({status:5,revocationType:'REFUND_PRORATED',revocationPercentage:50000})
  expect(()=>snapshot(transaction(),{...renewal(),originalTransactionId:'another'},1,config)).toThrow('apple_transaction_mismatch')
 })
 it('requires authenticated user, rejects arbitrary owner fields and hostile web origins',async()=>{
  const f=fixture()
  expect((await f.handle(req({action:'prepare'},false))).status).toBe(401)
  expect((await f.handle(req({action:'verify',signedTransaction:'signed',actor:'attacker'}))).status).toBe(400)
  expect((await f.handle(req({action:'prepare'},true,'https://attacker.test'))).status).toBe(403)
  expect(f.provider.transaction).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled()
 })
 it('prepares only a server-owned token, not a caller-supplied account',async()=>{
  const f=fixture(),response=await f.handle(req({action:'prepare'}))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({appAccountToken:accountToken,productIds:config.productIds,subscription:{active:true},sync:{writeAllowed:true}})
  expect(f.rpc).toHaveBeenCalledWith('apple_billing_prepare',{actor,env:'production'})
 })
 it('verifies JWS and current Apple state before persistence',async()=>{
  const f=fixture(),response=await f.handle(req({action:'verify',signedTransaction:'signed'}))
  expect(response.status).toBe(200);expect(f.provider.transaction).toHaveBeenCalledWith('signed');expect(f.provider.current).toHaveBeenCalledWith('123')
  expect(f.rpc).toHaveBeenCalledWith('apple_billing_apply',expect.objectContaining({actor,env:'production',snapshot:expect.objectContaining({originalTransactionId:'123',appAccountToken:accountToken})}))
 })
 it('never moves a restored transaction to the current unrelated account',async()=>{
  const f=fixture();f.query.maybeSingle.mockResolvedValueOnce({data:{user_id:'other'},error:null})
  const response=await f.handle(req({action:'verify',signedTransaction:'signed'}))
  expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'purchase_owned_by_another_account'})
  expect(f.provider.current).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled()
 })
 it('keeps verification and restore available while new purchases are disabled',async()=>{
  const f=fixture({enabled:false})
  expect((await f.handle(req({action:'prepare'}))).status).toBe(503)
  expect((await f.handle(req({action:'verify',signedTransaction:'signed'}))).status).toBe(200)
  expect((await f.handle(req({action:'refresh'}))).status).toBe(200)
 })
 it('keeps Sandbox restricted and never changes the production environment from request fields',async()=>{
  const f=fixture({environment:'sandbox',allowedUserIds:[]})
  expect((await f.handle(req({action:'prepare'}))).status).toBe(403)
  expect((await fixture().handle(req({action:'verify',signedTransaction:'signed',environment:'sandbox'}))).status).toBe(400)
 })
 it('does not acknowledge invalid signatures or provider outages and does not expose exception bodies',async()=>{
  const f=fixture();vi.mocked(f.provider.notification).mockRejectedValueOnce(new AppleBillingError('invalid_apple_signature',401))
  expect((await f.handle(req({signedPayload:'forged'},false),'webhook')).status).toBe(401)
  expect(f.rpc).not.toHaveBeenCalled()
  vi.mocked(f.provider.current).mockRejectedValueOnce(new Error('private provider credentials'))
  const response=await f.handle(req({action:'verify',signedTransaction:'signed'}))
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'apple_billing_unavailable'})
 })
 it('checks notification current-state ownership and atomically stores a verified event',async()=>{
  const f=fixture();expect((await f.handle(req({signedPayload:'signed'},false),'webhook')).status).toBe(200)
  expect(f.rpc).toHaveBeenCalledWith('apple_billing_apply',expect.objectContaining({actor:null,env:'production',event_input:expect.any(String)}))
  vi.mocked(f.provider.current).mockResolvedValueOnce({...snapshot(transaction(),renewal(),1,config),appAccountToken:'33333333-3333-4333-8333-333333333333'})
  expect((await f.handle(req({signedPayload:'signed'},false),'webhook')).status).toBe(409)
 })
 it('accepts a signed TEST without creating any entitlement and rejects oversized requests',async()=>{
  const f=fixture();vi.mocked(f.provider.notification).mockResolvedValueOnce({notificationUUID:crypto.randomUUID(),notificationType:'TEST'})
  expect((await f.handle(req({signedPayload:'signed'},false),'webhook')).status).toBe(200)
  expect(f.rpc).toHaveBeenCalledWith('apple_billing_apply',expect.objectContaining({snapshot:null}))
  expect((await f.handle(req({signedPayload:'x'.repeat(262145)},false),'webhook')).status).toBe(413)
 })
})
