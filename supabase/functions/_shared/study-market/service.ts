import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudyMarketListing, StudyMarketOrder, StudyMarketSeller, StudyMarketDashboard } from '../../../../src/shared/types/studyMarket.ts'
import { LIMITS, MarketError, requiredText, uuid, validateFiles, sha256, randomToken, inspectBytes, settlementDue, koreaDate } from './policy.ts'
import { createToss, verifyWebhook, unwrap } from './toss.ts'

// Database rows are mapped explicitly into public DTOs. Never return a raw row:
// storage paths, checkout hashes and provider identifiers stay server-side.
type Row = Record<string, any>
export interface MarketConfig {
  supabaseUrl: string; webOrigin: string; environment: 'test'|'live'; enabled: boolean;
  clientKey: string; secretKey: string; payoutSecretKey: string; securityKey: string; cronSecret: string
}
export function paymentConfigured(c: MarketConfig): boolean {
  const p=`${c.environment}_`
  return c.enabled && c.clientKey.startsWith(`${p}ck_`) && c.secretKey.startsWith(`${p}sk_`) && c.payoutSecretKey.startsWith(`${p}sk_`) && /^[a-f0-9]{64}$/i.test(c.securityKey)
}
function checked<T>(r:{data:T;error:{message:string;code?:string}|null}):NonNullable<T> {
  if(r.error) {
    const allowed=['not_purchasable','school_mismatch','purchase_exists','payment_mismatch','live_not_ready','operator_review_required','not_authorized','invalid_refund','payout_in_progress','purchase_required','listing_blocked','seller_not_ready','calendar_unverified','invalid_publish','files_not_verified','immutable_version','rate_limited','upload_quota_exceeded']
    throw new MarketError(allowed.includes(r.error.message)?r.error.message:'database_request_failed',409)
  }
  return r.data as NonNullable<T>
}
const fileDto=(f:Row)=>({id:f.id,path:f.rel_path,bytes:Number(f.bytes),sha256:f.sha256??f.expected_sha256,mime:f.mime,preview:f.preview})
function sellerDto(s:Row|null):StudyMarketSeller {
  return {status:!s?'unregistered':s.held?'suspended':['APPROVED','PARTIALLY_APPROVED'].includes(s.status)?'ready':s.status==='KYC_REQUIRED'?'verification_required':s.provider_id?'pending':'unregistered',displayName:s?.display_name??''}
}
function safeReceipt(value:unknown):string|null {
  if(typeof value!=='string')return null
  try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='tosspayments.com'||u.hostname.endsWith('.tosspayments.com'))?u.href:null}catch{return null}
}
export function createStudyMarketService(db:SupabaseClient,config:MarketConfig,fetcher:typeof fetch=fetch,clock=()=>new Date()) {
  const toss=createToss(config,fetcher), table=(name:string)=>db.from(`study_market_${name}`)
  async function one(name:string,column:string,id:string):Promise<Row|null>{return checked(await table(name).select('*').eq(column,id).maybeSingle())}
  async function actor(request:Request):Promise<string> {
    const authorization=request.headers.get('authorization')??''
    if(!authorization.startsWith('Bearer '))throw new MarketError('sign_in_required',401)
    const {data,error}=await db.auth.getUser(authorization.slice(7))
    if(error||!data.user)throw new MarketError('sign_in_required',401)
    return data.user.id
  }
  async function isOperator(user:string):Promise<boolean>{return (await one('operators','user_id',user))!==null}
  async function ready():Promise<boolean>{
    if(!paymentConfigured(config))return false
    if(config.environment==='test')return true
    const r=await one('readiness','id','true')
    return !!(r?.live_enabled&&r.contracts_verified&&r.policies_verified&&r.webhook_verified&&r.payout_verified)
  }
  async function requireTrading(){if(!await ready())throw new MarketError('trading_not_ready',503)}
  async function membership(user:string,school?:string):Promise<string>{
    if(!user&&school){const s=await one('schools','id',school);if(s?.enabled)return school;throw new MarketError('school_not_registered',404)}
    const m=await one('members','user_id',user)
    if(!m || (school!==undefined&&m.school_id!==school))throw new MarketError('school_mismatch',403)
    return m.school_id
  }
  async function ownVersion(user:string,version:string):Promise<{v:Row;l:Row}>{
    const v=await one('versions','id',uuid(version)),l=v?await one('listings','id',v.listing_id):null
    if(!v||!l||l.seller_id!==user)throw new MarketError('not_found',404)
    return {v,l}
  }
  async function audit(user:string|null,action:string,id:string,reason=''){checked(await table('audit').insert({actor:user,action,entity_id:id,reason}))}
  async function files(version:string):Promise<Row[]>{return checked(await table('files').select('*').eq('version_id',version).order('rel_path'))}
  async function listingDto(l:Row,user:string):Promise<StudyMarketListing>{
    const course=await one('courses','id',l.course_id),seller=await one('sellers','user_id',l.seller_id)
    const fs=l.current_version_id?await files(l.current_version_id):[]
    const urls:string[]=[]
    for(const f of fs.filter(f=>f.preview&&f.state==='verified')){
      const result=checked(await db.storage.from('study-market-files').createSignedUrl(f.final_path,300));urls.push(result.signedUrl)
    }
    const owned=!!user&&checked(await table('orders').select('id').eq('buyer_id',user).eq('listing_id',l.id).eq('status','paid').limit(1)).length>0
    return {id:l.id,versionId:l.current_version_id??'',universityId:l.school_id,course:{id:l.course_id,universityId:l.school_id,name:course?.name??''},sellerId:l.seller_id,sellerName:seller?.display_name??'',title:l.title,description:l.description,price:l.price,professor:l.professor??'',semester:l.semester,status:l.status==='processing'?'sealing':l.status==='paused'?'withdrawn':l.status,files:fs.map(fileDto),previewUrls:urls,createdAt:l.created_at,updatedAt:l.updated_at,owned}
  }
  async function orderDto(o:Row):Promise<StudyMarketOrder>{
    const l=await one('listings','id',o.listing_id),course=l?await one('courses','id',l.course_id):null
    return {id:o.id,listingId:o.listing_id,versionId:o.version_id,title:o.title,courseName:course?.name??'',amount:o.amount,fee:o.fee,sellerAmount:o.seller_amount,status:o.status==='expired'?'cancelled':['review','refund_due'].includes(o.status)?'refund_pending':o.status,createdAt:o.created_at,paidAt:o.paid_at,supplyStartedAt:o.downloaded_at,receiptUrl:safeReceipt(o.receipt_url),...(o.refund_reason?{refundReason:o.refund_reason}:{})}
  }
  async function ownedOrder(user:string,id:string){const o=await one('orders','id',uuid(id));if(!o||o.buyer_id!==user)throw new MarketError('not_found',404);return o}
  async function applyPayment(p:Row):Promise<Row>{
    const o=await one('orders','id',uuid(p.orderId))
    if(!o||typeof p.paymentKey!=='string'||p.currency!=='KRW'||!Number.isInteger(p.totalAmount)||p.totalAmount!==o.amount)throw new MarketError('payment_mismatch',409)
    const r=checked(await db.rpc('study_market_apply_payment',{order_input:o.id,payment_input:p.paymentKey,amount_input:p.totalAmount,currency_input:p.currency,status_input:p.status,approved_input:p.approvedAt??null,env:config.environment})) as Row
    const receipt=safeReceipt(p.receipt?.url)
    if(receipt)checked(await table('orders').update({receipt_url:receipt}).eq('id',o.id))
    return {...r,receipt_url:receipt??r.receipt_url}
  }
  async function tokenOrder(input:Row):Promise<Row>{
    const token=requiredText(input.token,100)
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new MarketError('invalid_checkout',401)
    const o=await one('orders','checkout_token_hash',await sha256(token))
    if(!o||o.environment!==config.environment)throw new MarketError('invalid_checkout',401)
    if(o.status==='pending'&&Date.parse(o.checkout_expires_at)<clock().getTime())throw new MarketError('checkout_expired',410)
    return o
  }
  async function refund(user:string,id:string,reason:string):Promise<Row>{
    const o=checked(await db.rpc('study_market_begin_refund',{actor:user,order_input:uuid(id),reason_input:requiredText(reason,2000)})) as Row
    if(o.status==='refunded')return o
    if(!o.payment_key)throw new MarketError('payment_not_found',409)
    try{return await applyPayment(await toss.cancel(o.payment_key,o.refund_reason,o.refund_key))}
    catch{const p=await toss.payment(o.payment_key);if(p.status==='CANCELED')return applyPayment(p);throw new MarketError('refund_pending',503)}
  }
  async function dispatch(action:string,input:Row,user:string|null):Promise<unknown>{
    if(action==='checkoutSession'){
      await requireTrading();const o=await tokenOrder(input)
      if(o.status!=='pending')return {order:await orderDto(o)}
      return {orderId:o.id,orderName:o.title,amount:o.amount,customerKey:`buyer_${o.buyer_id}`,clientKey:config.clientKey,successUrl:`${config.webOrigin}/checkout/success`,failUrl:`${config.webOrigin}/checkout/fail`,expiresAt:o.checkout_expires_at}
    }
    if(action==='confirmPayment'){
      await requireTrading();const o=await tokenOrder(input)
      if(input.orderId!==o.id||input.amount!==o.amount)throw new MarketError('payment_mismatch',409)
      const key=requiredText(input.paymentKey,200)
      if(o.payment_key&&o.payment_key!==key)throw new MarketError('payment_mismatch',409)
      if(o.status!=='pending')return orderDto(o)
      let p:Row
      try{p=await toss.confirm(o.id,key,o.amount)}catch{p=await toss.payment(key)}
      if(p.orderId!==o.id||p.paymentKey!==key)throw new MarketError('payment_mismatch',409)
      return orderDto(await applyPayment(p))
    }
    const signedUser=user
    if(!signedUser&&!['context','courses','listings','listing'].includes(action))throw new MarketError('sign_in_required',401)
    user=user??''
    if(action==='context'){
      if(input.universityId){
        const school=await one('schools','id',requiredText(input.universityId,100))
        if(!school?.enabled)throw new MarketError('school_not_registered',409)
        if(user)checked(await table('members').upsert({user_id:user,school_id:school.id,updated_at:clock().toISOString()}))
      }
      return {universities:checked(await table('schools').select('id,name').eq('enabled',true).order('name')),tradingEnabled:await ready(),notice:await ready()?'':'결제·정산 운영 준비 중입니다. 자료를 둘러보고 판매 초안을 준비할 수 있어요.'}
    }
    if(action==='requestUniversity'){
      const name=requiredText(input.name,100)
      const exists=checked(await table('cases').select('id').eq('user_id',user).eq('kind','school').eq('subject_id',name).eq('status','open').limit(1))
      if(!exists.length)checked(await table('cases').insert({user_id:user,kind:'school',subject_id:name,reason:name}))
      return {ok:true}
    }
    if(action==='courses'||action==='createCourse'){
      const school=await membership(user,requiredText(input.universityId,100))
      if(action==='createCourse'){
        const name=requiredText(input.name,100),normalized=name.replace(/\s+/g,' ').toLocaleLowerCase('ko-KR')
        const row=checked(await table('courses').upsert({school_id:school,name,normalized_name:normalized},{onConflict:'school_id,normalized_name,professor,course_code'}).select('*').single())
        return {id:row.id,universityId:row.school_id,name:row.name}
      }
      let q=table('courses').select('*').eq('school_id',school).order('name').limit(50)
      if(input.q)q=q.ilike('name',`%${requiredText(input.q,100).replace(/[%_\\]/g,'')}%`)
      return checked(await q).map((c:Row)=>({id:c.id,universityId:c.school_id,name:c.name}))
    }
    if(action==='listings'){
      const school=await membership(user,requiredText(input.universityId,100)),offset=input.cursor?Number(input.cursor):0
      if(!Number.isInteger(offset)||offset<0||offset>100000)throw new MarketError('invalid_cursor')
      let q=table('listings').select('*').eq('school_id',school).eq('status','published').order(input.sort==='price'?'price':'created_at',{ascending:input.sort==='price'}).order('id').range(offset,offset+23)
      if(input.q)q=q.ilike('title',`%${requiredText(input.q,100).replace(/[%_\\]/g,'')}%`)
      if(input.courseIds){if(!Array.isArray(input.courseIds)||input.courseIds.length>100)throw new MarketError('invalid_courses');if(input.courseIds.length)q=q.in('course_id',input.courseIds.map(uuid))}
      const rows=checked(await q)
      return {listings:await Promise.all(rows.map((l:Row)=>listingDto(l,user))),nextCursor:rows.length===24?String(offset+24):null}
    }
    if(action==='listing'){
      const l=await one('listings','id',uuid(input.id));if(!l)throw new MarketError('not_found',404)
      if(l.seller_id!==user){await membership(user,l.school_id);if(l.status!=='published')throw new MarketError('not_found',404)}
      return listingDto(l,user)
    }
    if(action==='dashboard'){
      const s=await one('sellers','user_id',user),ls=checked(await table('listings').select('*').eq('seller_id',user).order('updated_at',{ascending:false}).limit(100)),orders=checked(await table('orders').select('*').eq('buyer_id',user).order('created_at',{ascending:false}).limit(100)),payouts=checked(await table('payouts').select('*').eq('seller_id',user).order('created_at',{ascending:false}).limit(100)),ledger=checked(await table('ledger').select('amount,payout_id').eq('seller_id',user))
      const sales=await table('orders').select('id',{count:'exact',head:true}).eq('seller_id',user).eq('status','paid')
      if(sales.error)throw new MarketError('database_request_failed',503)
      return {configured:true,tradingEnabled:await ready(),signedIn:true,operator:await isOperator(user),seller:sellerDto(s),listings:await Promise.all(ls.map((l:Row)=>listingDto(l,user))),purchases:await Promise.all(orders.map(orderDto)),payouts:payouts.map((p:Row)=>({id:p.id,amount:Number(p.amount),status:p.status==='completed'?'paid':p.status==='requested'?'pending':p.status==='review'?'held':p.status,scheduledAt:`${p.run_date}T12:00:00+09:00`,paidAt:p.status==='completed'?p.updated_at:null,reason:p.status==='review'?'지급 결과 확인 중':''})),salesCount:sales.count??0,pendingAmount:ledger.filter((l:Row)=>!l.payout_id).reduce((n:number,l:Row)=>n+l.amount,0),paidAmount:payouts.filter((p:Row)=>p.status==='completed').reduce((n:number,p:Row)=>n+Number(p.amount),0),notice:await ready()?'':'결제·정산 운영 준비 중입니다.'} satisfies StudyMarketDashboard
    }
    if(action==='saveDraft'){
      const school=await membership(user,requiredText(input.universityId,100)),course=await one('courses','id',uuid(input.courseId))
      if(course?.school_id!==school)throw new MarketError('school_mismatch',403)
      if(!Number.isSafeInteger(input.price)||input.price<1||input.price>1000000000)throw new MarketError('invalid_price')
      const fs=validateFiles(input.files),title=requiredText(input.title,100),description=requiredText(input.description,4000)
      let seller=await one('sellers','user_id',user)
      if(!seller){const profile=checked(await db.from('profiles').select('nickname').eq('id',user).maybeSingle());seller=checked(await table('sellers').insert({user_id:user,ref_id:`bd${user.replace(/-/g,'').slice(0,18)}`,display_name:profile?.nickname??'판매자',environment:config.environment}).select('*').single())}
      let l=input.id?await one('listings','id',uuid(input.id)):null
      if(input.id&&(!l||l.seller_id!==user))throw new MarketError('not_found',404)
      if(l?.status==='blocked')throw new MarketError('listing_blocked',403)
      if(l&&l.school_id!==school)throw new MarketError('school_mismatch',403)
      const metadata={school_id:school,course_id:course.id,title,description,price:input.price,professor:typeof input.professor==='string'?input.professor.trim().slice(0,100):'',semester:typeof input.semester==='string'?input.semester.trim().slice(0,40):'',updated_at:clock().toISOString()}
      if(l){checked(await table('listings').update(metadata).eq('id',l.id));l={...l,...metadata}}
      else l=checked(await table('listings').insert({...metadata,seller_id:user}).select('*').single())
      if(!l)throw new MarketError('database_request_failed',503)
      const previous=l.current_version_id?await one('versions','id',l.current_version_id):null
      const old=previous?await files(previous.id):[]
      const same=previous?.state!=='rejected'&&old.length===fs.length&&fs.every(f=>old.some(x=>x.id===f.id&&x.rel_path===f.path&&x.bytes===f.bytes&&x.expected_sha256===f.sha256&&x.preview===f.preview))
      if(same&&input.rightsConfirmed===true)checked(await table('versions').update({rights_attested_at:clock().toISOString()}).eq('id',l.current_version_id).neq('state','ready'))
      if(!same){
        const versionId=checked(await db.rpc('study_market_create_version',{actor:user,listing_input:l.id,files_input:fs,attested:input.rightsConfirmed===true})) as string
        l={...l,current_version_id:versionId,status:'draft'}
      }
      return listingDto(l,user)
    }
    if(action==='uploadGrant'||action==='finalizeFile'){
      const {v,l}=await ownVersion(user,input.versionId),f=checked(await table('files').select('*').eq('version_id',v.id).eq('id',uuid(input.fileId)).single())
      if(l.status==='blocked')throw new MarketError('listing_blocked',403)
      if(v.state==='ready'&&f.state!=='verified')throw new MarketError('immutable_version',409)
      if(action==='uploadGrant'){
        if(f.state==='verified')return {alreadyVerified:true,url:'',token:'',bucket:'study-market-staging',objectPath:f.staging_path,resumableUrl:''}
        if(v.state!=='uploading'||f.state!=='pending')throw new MarketError('upload_closed',409)
        const grant=checked(await db.storage.from('study-market-staging').createSignedUploadUrl(f.staging_path,{upsert:false}))
        const origin=new URL(config.supabaseUrl);origin.hostname=origin.hostname.replace('.supabase.co','.storage.supabase.co')
        return {url:grant.signedUrl,token:grant.token,bucket:'study-market-staging',objectPath:f.staging_path,resumableUrl:`${origin.origin}/storage/v1/upload/resumable`}
      }
      if(f.state==='verified')return {ok:true}
      // Copy first, then hash the immutable destination. A valid staging grant
      // issued before sealing has no authority over this destination bucket.
      if(f.state==='pending'){
        const copied=await db.storage.from('study-market-staging').copy(f.staging_path,f.final_path,{destinationBucket:'study-market-files'})
        if(copied.error){const exists=await db.storage.from('study-market-files').info(f.final_path);if(exists.error)throw new MarketError('upload_incomplete',409)}
        checked(await table('files').update({state:'copied'}).eq('version_id',v.id).eq('id',f.id).eq('state','pending'))
      }
      const object=checked(await db.storage.from('study-market-files').download(f.final_path))
      if(object.size!==Number(f.bytes)||object.size>LIMITS.file)throw new MarketError('file_size_mismatch')
      const bytes=new Uint8Array(await object.arrayBuffer()),hash=await sha256(bytes)
      if(hash!==f.expected_sha256)throw new MarketError('file_hash_mismatch')
      inspectBytes(f.rel_path,bytes)
      if(f.preview){
        if(bytes.length<24)throw new MarketError('invalid_preview')
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20)
        if(width<1||height<1||width>4096||height>4096||width*height>16_777_216)throw new MarketError('invalid_preview')
      }
      checked(await table('files').update({state:'verified',sha256:hash}).eq('version_id',v.id).eq('id',f.id))
      return {ok:true}
    }
    if(action==='publish'){
      await requireTrading()
      const {v,l}=await ownVersion(user,input.versionId)
      const fs=await files(v.id)
      if(fs.some(f=>f.state!=='verified')||!fs.some(f=>f.preview))throw new MarketError('files_not_verified',409)
      checked(await table('versions').update({state:'sealing'}).eq('id',v.id).eq('state','uploading'))
      const hash=await sha256(JSON.stringify(fs.map(fileDto)))
      checked(await db.rpc('study_market_publish',{actor:user,version_input:v.id,manifest_hash:hash}))
      return listingDto((await one('listings','id',l.id))!,user)
    }
    if(action==='withdraw'){
      const l=await one('listings','id',uuid(input.listingId));if(l?.seller_id!==user)throw new MarketError('not_found',404)
      if(l.status!=='blocked')checked(await table('listings').update({status:'paused',updated_at:clock().toISOString()}).eq('id',l.id))
      return {ok:true}
    }
    if(action==='registerSeller'){
      await requireTrading()
      const s=await one('sellers','user_id',user),displayName=requiredText(input.displayName,80)
      if(s?.provider_id)return sellerDto(s)
      const ref=s?.ref_id??`bd${user.replace(/-/g,'').slice(0,18)}`
      const email=requiredText(input.email,100),phone=requiredText(input.phone,20),bankCode=requiredText(input.bankCode,3),accountNumber=requiredText(input.accountNumber,14)
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{8,20}$/.test(phone)||!/^\d{2,3}$/.test(bankCode)||!/^\d{1,14}$/.test(accountNumber))throw new MarketError('invalid_seller_details')
      // Personal/account data goes straight to the provider; never to logs or DB.
      const provider=await toss.registerSeller({refSellerId:ref,businessType:'INDIVIDUAL',individual:{name:requiredText(input.name,50),email,phone},account:{bankCode,accountNumber,holderName:requiredText(input.holderName,50)}},`seller-${user}`)
      if(provider.refSellerId!==ref||typeof provider.id!=='string'||typeof provider.status!=='string')throw new MarketError('invalid_provider_response',502)
      const row=checked(await table('sellers').upsert({user_id:user,ref_id:ref,provider_id:provider.id,status:provider.status,display_name:displayName,environment:config.environment,updated_at:clock().toISOString()}).select('*').single())
      return sellerDto(row)
    }
    if(action==='order'){
      await requireTrading();const listingId=uuid(input.listingId),token=randomToken()
      const o=checked(await db.rpc('study_market_create_order',{actor:user,listing:listingId,request_key:crypto.randomUUID(),token_hash:await sha256(token),env:config.environment})) as Row
      return {...await orderDto(o),checkoutUrl:`${config.webOrigin}/checkout#token=${token}`}
    }
    if(action==='orderStatus'){
      let o=await ownedOrder(user,input.orderId)
      if(o.status==='pending'&&paymentConfigured(config)){try{o=await applyPayment(await toss.paymentByOrder(o.id))}catch{/* Keep pending on unavailable/unconfirmed provider. */}}
      if(input.refreshCheckout===true&&o.status==='pending'){
        await requireTrading()
        if(Date.parse(o.checkout_expires_at)<=clock().getTime())throw new MarketError('checkout_expired',410)
        const token=randomToken()
        checked(await table('orders').update({checkout_token_hash:await sha256(token)}).eq('id',o.id).eq('status','pending'))
        return {...await orderDto(o),checkoutUrl:`${config.webOrigin}/checkout#token=${token}`}
      }
      return orderDto(o)
    }
    if(action==='download'){
      if(input.acceptSupply!==true)throw new MarketError('supply_consent_required')
      const o=await ownedOrder(user,input.orderId)
      if(o.status!=='paid')throw new MarketError('purchase_required',409)
      const fs=await files(o.version_id),dto=await orderDto(o),grants=[]
      for(const f of fs.filter(f=>!f.preview)){const result=checked(await db.storage.from('study-market-files').createSignedUrl(f.final_path,300,{download:f.name}));grants.push({...fileDto(f),url:result.signedUrl})}
      // No signed URL escapes until the locked entitlement check and supply event commit.
      checked(await db.rpc('study_market_download',{actor:user,order_input:o.id}))
      return {orderId:o.id,title:o.title,courseName:dto.courseName,files:grants}
    }
    if(action==='downloadComplete'){
      const o=await ownedOrder(user,input.orderId)
      await audit(user,input.success===true?'download_completed':'download_failed',o.id,typeof input.reason==='string'?input.reason.slice(0,500):'')
      return {ok:true}
    }
    if(action==='refund'){
      await ownedOrder(user,input.orderId)
      try{return orderDto(await refund(user,input.orderId,input.reason))}catch(error){
        if(!(error instanceof MarketError)||error.code!=='operator_review_required')throw error
        const reason=requiredText(input.reason,2000)
        checked(await db.rpc('study_market_request_refund_review',{actor:user,order_input:input.orderId,reason_input:reason}))
        return {...await orderDto(await ownedOrder(user,input.orderId)),refundReason:'운영자가 환불 요청을 검토하고 있어요.'}
      }
    }
    if(action==='report'){
      const l=await one('listings','id',uuid(input.listingId));if(!l)throw new MarketError('not_found',404)
      await membership(user,l.school_id)
      checked(await table('reports').upsert({user_id:user,listing_id:l.id,reason:requiredText(input.reason,2000)},{onConflict:'user_id,listing_id'}))
      return {ok:true}
    }
    if(action==='operatorDashboard'||action==='operatorAction'){
      if(!await isOperator(user))throw new MarketError('operator_required',403)
      if(action==='operatorDashboard'){
        const reports=checked(await table('reports').select('*').eq('status','open').order('created_at').limit(100)),cases=checked(await table('cases').select('*').eq('status','open').order('created_at').limit(100)),payouts=checked(await table('payouts').select('*').in('status',['review','failed','reserved','requested']).order('created_at').limit(100)),auditRows=checked(await table('audit').select('id,action,reason,created_at').order('created_at',{ascending:false}).limit(100))
        return {cases:[...reports.map((r:Row)=>({id:r.id,kind:'report',subjectId:r.listing_id,reason:r.reason,status:r.status,createdAt:r.created_at})),...cases.map((r:Row)=>({id:r.id,kind:r.kind,subjectId:r.kind==='receivable'?r.user_id:r.subject_id,reason:r.reason,status:r.status,createdAt:r.created_at})),...payouts.map((p:Row)=>({id:p.id,kind:'payout',subjectId:p.seller_id,reason:'지급 결과 확인 필요',status:p.status,createdAt:p.created_at,amount:Number(p.amount)}))],audit:auditRows.map((r:Row)=>({id:String(r.id),action:r.action,reason:r.reason,createdAt:r.created_at}))}
      }
      const reason=requiredText(input.reason,2000),id=requiredText(input.id,100)
      switch(input.action){
        case 'block':checked(await table('listings').update({status:'blocked'}).eq('id',uuid(id)));break
        case 'restore':checked(await table('listings').update({status:'paused'}).eq('id',uuid(id)).eq('status','blocked'));break
        case 'holdSeller':case 'releaseSeller':checked(await table('sellers').update({held:input.action==='holdSeller'}).eq('user_id',uuid(id)));break
        case 'refund':await refund(user,id,reason);checked(await table('cases').update({status:'resolved'}).eq('subject_id',id).eq('kind','refund'));break
        case 'rejectRefund':checked(await db.rpc('study_market_reject_refund',{actor:user,order_input:uuid(id),reason_input:reason}));break
        case 'resolveReport':checked(await table('reports').update({status:'resolved'}).eq('id',uuid(id)));break
        case 'addUniversity':if(!/^[a-z][a-z0-9-]{1,79}$/.test(id))throw new MarketError('invalid_school_id');checked(await table('schools').insert({id,name:requiredText(input.name,100)}));checked(await table('cases').update({status:'resolved'}).eq('kind','school').eq('subject_id',input.name));break
        default:throw new MarketError('invalid_action')
      }
      await audit(user,input.action,id,reason);return {ok:true}
    }
    throw new MarketError('unknown_action',404)
  }
  async function webhook(request:Request,raw:string):Promise<unknown>{
    const event=JSON.parse(raw) as Row
    if(['seller.changed','payout.changed'].includes(event.eventType)){
      if(!await verifyWebhook(raw,request.headers,config.securityKey,clock()))throw new MarketError('invalid_webhook',401)
      const eventId=requiredText(event.eventId,200)
      if(await one('webhooks','id',eventId))return {ok:true}
      const entity=unwrap(event.entityBody),id=requiredText(entity.id,100)
      if(event.eventType==='seller.changed'){
        const seller=await one('sellers','provider_id',id)
        if(seller){const fresh=await toss.seller(id);if(fresh.refSellerId!==seller.ref_id)throw new MarketError('provider_mismatch',409);checked(await table('sellers').update({status:fresh.status,updated_at:clock().toISOString()}).eq('user_id',seller.user_id))}
      }else await applyPayout(await toss.payout(id))
      checked(await table('webhooks').upsert({id:eventId,event_type:event.eventType}));return {ok:true}
    }
    if(event.eventType==='PAYMENT_STATUS_CHANGED'){
      const data=event.data as Row,orderId=uuid(data?.orderId)
      if(!await one('orders','id',orderId))return {ok:true}
      const fresh=await toss.payment(requiredText(data.paymentKey,200))
      if(fresh.orderId!==orderId)throw new MarketError('payment_mismatch',409)
      await applyPayment(fresh);return {ok:true}
    }
    throw new MarketError('unsupported_webhook',400)
  }
  async function applyPayout(provider:Row){
    const p=await one('payouts','id',uuid(provider.refPayoutId));if(!p)throw new MarketError('unknown_payout',404)
    const seller=await one('sellers','user_id',p.seller_id)
    if(provider.destination!==seller?.provider_id||provider.amount?.value!==Number(p.amount)||provider.amount?.currency!=='KRW'||(p.provider_id&&provider.id!==p.provider_id))throw new MarketError('payout_mismatch',409)
    const state=provider.status==='COMPLETED'?'completed':['FAILED','REJECTED','CANCELED','DELETED'].includes(provider.status)?'failed':['REQUESTED','IN_PROGRESS','PENDING'].includes(provider.status)?'requested':'review'
    checked(await db.rpc('study_market_apply_payout',{payout_input:p.id,provider_input:requiredText(provider.id,100),status_input:state}))
  }
  async function cron(request:Request):Promise<unknown>{
    if(config.cronSecret.length<32||request.headers.get('authorization')!==`Bearer ${config.cronSecret}`)throw new MarketError('not_authorized',401)
    const started=Date.now(),exhausted=()=>Date.now()-started>60_000
    // Storage deletion always uses its API, never SQL against storage.objects.
    const abandoned=checked(await table('versions').select('*').in('state',['uploading','sealing','rejected']).is('cleaned_at',null).lt('created_at',new Date(clock().getTime()-7*86400000).toISOString()).limit(20))
    for(const v of abandoned){
      if(exhausted())return {ok:true,deferred:true}
      const purchases=checked(await table('orders').select('id').eq('version_id',v.id).limit(1))
      if(purchases.length)continue
      const fs=await files(v.id)
      const claimed=checked(await table('versions').update({state:'rejected'}).eq('id',v.id).neq('state','ready').is('cleaned_at',null).select('id'))
      if(!claimed.length)continue
      if(fs.length){checked(await db.storage.from('study-market-staging').remove(fs.map(f=>f.staging_path)));checked(await db.storage.from('study-market-files').remove(fs.map(f=>f.final_path)))}
      checked(await table('versions').update({cleaned_at:clock().toISOString()}).eq('id',v.id))
    }
    const sealed=checked(await table('versions').select('id').eq('state','ready').is('staging_cleaned_at',null).lt('created_at',new Date(clock().getTime()-3*3600000).toISOString()).limit(20))
    for(const v of sealed){if(exhausted())return {ok:true,deferred:true};const fs=await files(v.id);if(fs.length)checked(await db.storage.from('study-market-staging').remove(fs.map(f=>f.staging_path)));checked(await table('versions').update({staging_cleaned_at:clock().toISOString()}).eq('id',v.id))}
    checked(await table('rate').delete().lt('created_at',new Date(clock().getTime()-2*86400000).toISOString()))
    // Reconcile pending operations even when new trading is disabled.
    const pending=checked(await table('orders').select('*').in('status',['pending','paid','refund_pending','refund_due','review']).order('last_reconciled_at',{ascending:true,nullsFirst:true}).limit(30))
    for(const o of pending){if(exhausted())return {ok:true,deferred:true};try{if(['refund_pending','refund_due'].includes(o.status)&&o.refund_key)await refund(o.buyer_id,o.id,o.refund_reason);else await applyPayment(o.payment_key?await toss.payment(o.payment_key):await toss.paymentByOrder(o.id))}catch{/* Keep durable state for next run/operator review. */}finally{checked(await table('orders').update({last_reconciled_at:clock().toISOString()}).eq('id',o.id))}}
    const processing=checked(await table('payouts').select('*').in('status',['requested','reserved']).order('last_reconciled_at',{ascending:true,nullsFirst:true}).limit(30))
    for(const p of processing){
      if(exhausted())return {ok:true,deferred:true}
      try{
        if(!p.provider_id&&clock().getTime()-Date.parse(p.created_at)>14*86400000)checked(await table('payouts').update({status:'review'}).eq('id',p.id))
        else if(p.provider_id)await applyPayout(await toss.payout(p.provider_id))
      }catch{/* retry latest provider state next tick */}finally{checked(await table('payouts').update({last_reconciled_at:clock().toISOString()}).eq('id',p.id))}
    }
    if(exhausted())return {ok:true,deferred:true}
    if(!await ready())return {ok:true,payouts:'disabled'}
    const today=koreaDate(clock()),from=new Date(clock().getTime()-8*86400000).toISOString().slice(0,10)
    const days=checked(await table('business_days').select('*').gte('date',from).lte('date',today)),calendar=new Map<string,boolean>(days.map((d:Row)=>[d.date,d.is_business_day]))
    const years=checked(await table('calendar_years').select('year').in('year',[Number(from.slice(0,4)),Number(today.slice(0,4))]))
    if(![...new Set([Number(from.slice(0,4)),Number(today.slice(0,4))])].every(y=>years.some((r:Row)=>r.year===y)))return {ok:true,payouts:'calendar_unverified'}
    if(!settlementDue(clock(),calendar))return {ok:true,payouts:'not_due_or_calendar_unverified'}
    const balance:Row=await toss.balance();let available=Number(balance.availableAmount?.value??0)
    if(balance.availableAmount?.currency!=='KRW'||!Number.isSafeInteger(available))throw new MarketError('invalid_provider_balance',502)
    // Paginate sellers so one busy batch cannot starve later accounts.
    let cursor=(await one('jobs','name','payout_scan'))?.cursor??''
    for(let page=0;page<1;page++){
      let query=table('sellers').select('*').eq('held',false).in('status',['APPROVED','PARTIALLY_APPROVED']).eq('environment',config.environment).order('user_id').limit(100)
      if(cursor)query=query.gt('user_id',cursor)
      const sellers=checked(await query)
      for(const s of sellers){
        if(exhausted())return {ok:true,deferred:true}
        try{
          // A retry always reuses its original idempotency key, including a
          // previous week's reservation. Never silently release an unknown send.
          const existing=checked(await table('payouts').select('*').eq('seller_id',s.user_id).eq('environment',config.environment).eq('status','reserved').order('created_at').limit(1))
          const p=existing[0]??checked(await db.rpc('study_market_reserve_payout',{seller_input:s.user_id,date_input:today,env:config.environment})) as Row|null
          if(!p||p.status!=='reserved')continue
          if(clock().getTime()-Date.parse(p.created_at)>14*86400000){checked(await table('payouts').update({status:'review'}).eq('id',p.id));continue}
          if(available<Number(p.amount))continue
          // Reports or blocks that arrived after reservation suspend submission.
          const allocations=checked(await table('ledger').select('order_id').eq('payout_id',p.id))
          const orders=allocations.length?checked(await table('orders').select('listing_id,status').in('id',allocations.map((e:Row)=>e.order_id))):[]
          const listingIds=[...new Set(orders.map((o:Row)=>o.listing_id))]
          const blocked=listingIds.length?checked(await table('listings').select('id').in('id',listingIds).eq('status','blocked')):[]
          const disputes=listingIds.length?checked(await table('reports').select('id').in('listing_id',listingIds).eq('status','open')):[]
          if(blocked.length||disputes.length||orders.some((o:Row)=>!['paid','refunded'].includes(o.status)))continue
          const provider=await toss.requestPayout(p.id,s.provider_id,Number(p.amount));await applyPayout(provider);available-=Number(p.amount)
        }catch{/* Durable reservation is never released on an ambiguous network failure. */}finally{checked(await table('jobs').update({cursor:s.user_id}).eq('name','payout_scan'))}
      }
      cursor=sellers.length<100?'':sellers[sellers.length-1].user_id
      checked(await table('jobs').update({cursor}).eq('name','payout_scan'))
    }
    return {ok:true}
  }
  function allowedOrigin(origin:string|null):boolean {
    if(origin===config.webOrigin)return true
    if(!origin||config.environment!=='test')return false
    try{const host=new URL(config.supabaseUrl),candidate=new URL(origin);return ['localhost','127.0.0.1'].includes(host.hostname)&&['localhost','127.0.0.1'].includes(candidate.hostname)&&candidate.protocol==='http:'}catch{return false}
  }
  function response(body:unknown,status=200,origin:string|null=null):Response{
    return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(allowedOrigin(origin)?{'Access-Control-Allow-Origin':origin!,'Vary':'Origin'}:{})}})
  }
  async function bodyText(request:Request):Promise<string>{
    const reader=request.body?.getReader();if(!reader)throw new MarketError('request_body_required')
    const chunks:Uint8Array[]=[];let size=0
    while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>128*1024){await reader.cancel();throw new MarketError('request_too_large',413)}chunks.push(r.value)}
    const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length}return new TextDecoder('utf-8',{fatal:true}).decode(all)
  }
  return async(request:Request,kind:'api'|'webhook'|'cron'='api'):Promise<Response>=>{
    const origin=request.headers.get('origin')
    if(request.method==='OPTIONS'&&kind==='api'&&allowedOrigin(origin))return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin!,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST','Vary':'Origin'}})
    if(request.method!=='POST')return response({error:'method_not_allowed'},405,origin)
    if(kind==='api'&&origin&&!allowedOrigin(origin))return response({error:'origin_not_allowed'},403)
    try{
      if(kind==='cron')return response(await cron(request))
      const raw=await bodyText(request)
      if(kind==='webhook')return response(await webhook(request,raw))
      const body=JSON.parse(raw) as Row
      if(!body||typeof body.action!=='string'||!body.input||typeof body.input!=='object'||Array.isArray(body.input))throw new MarketError('invalid_request')
      const publicAction=['checkoutSession','confirmPayment'].includes(body.action)
      const anonymousRead=['context','courses','listings','listing'].includes(body.action)&&!request.headers.has('authorization')
      const user=publicAction||anonymousRead?null:await actor(request)
      checked(await db.rpc('study_market_check_rate',{actor_input:user??(publicAction?`checkout:${await sha256(String(body.input.token??'invalid'))}`:`browse:${await sha256(request.headers.get('x-forwarded-for')??'unknown')}`),max_input:publicAction?60:300}))
      return response(await dispatch(body.action,body.input,user),200,origin)
    }catch(error){return response({error:error instanceof MarketError?error.code:error instanceof SyntaxError?'invalid_json':'internal_error'},error instanceof MarketError?error.status:error instanceof SyntaxError?400:500,origin)}
  }
}
