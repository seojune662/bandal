import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudyMarketClient } from '../../../src/main/features/studyMarket/client'
import { execFileSync } from 'node:child_process'
import { createClient,type SupabaseClient } from '@supabase/supabase-js'
import { createStudyMarketService,type MarketConfig } from '../../../supabase/functions/_shared/study-market/service'
import { sha256 } from '../../../supabase/functions/_shared/study-market/policy'

const workdir=process.env.BANDAL_STUDY_MARKET_TEST_DIR
describe.skipIf(!workdir)('study market real Auth/RLS/Storage and financial RPC integration',()=>{
  let admin:SupabaseClient,anon:SupabaseClient,handle:ReturnType<typeof createStudyMarketService>
  let seller:{id:string;token:string;client:SupabaseClient},buyer:typeof seller,outsider:typeof seller
  let listing:any,order:any,refundOrder:any,course:any,grants:any[]=[],providerCalls=0
  const pdf=new TextEncoder().encode('%PDF-1.7\nfixture'),preview=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1])
  let fileInput:any[],url:string,key:string,localDir:string,main:ReturnType<typeof createStudyMarketClient>
  let interrupt=false,committedChunk=false,blockedAttempts=0
  const tusCalls:Array<{method:string;status:number;offset:string|null;metadataNames?:string[]}>=[]
  const providerPayments=new Map<string,any>()
  async function api(action:string,input:any={},token?:string){
    const response=await handle(new Request(`${url}/functions/v1/study-market`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({action,input})}))
    return {status:response.status,data:await response.json()}
  }
  async function user(name:string){
    const email=`${name}-${crypto.randomUUID()}@example.test`,password=`Bd-${crypto.randomUUID()}!`
    const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(error||!data.user)throw new Error('test user creation failed')
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),signed=await client.auth.signInWithPassword({email,password})
    if(signed.error||!signed.data.session)throw new Error('test user sign-in failed')
    return {id:data.user.id,token:signed.data.session.access_token,client}
  }
  beforeAll(async()=>{
    const status=JSON.parse(execFileSync('supabase',['status','--workdir',workdir!,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))
    url=status.API_URL;key=status.ANON_KEY;admin=createClient(url,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});anon=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    seller=await user('seller');buyer=await user('buyer');outsider=await user('outsider')
    const config:MarketConfig={supabaseUrl:url,webOrigin:'https://bandal.io',environment:'test',enabled:true,clientKey:'test_ck_fixture',secretKey:'test_sk_fixture',payoutSecretKey:'test_sk_fixture',securityKey:'11'.repeat(32),cronSecret:'a'.repeat(40)}
    handle=createStudyMarketService(admin,config,async(raw,init)=>{
      providerCalls++;const path=new URL(String(raw)).pathname
      if(path==='/v1/payments/confirm'){
        const body=JSON.parse(String(init?.body)),p={orderId:body.orderId,paymentKey:body.paymentKey,totalAmount:body.amount,currency:'KRW',status:'DONE',approvedAt:new Date().toISOString()};providerPayments.set(p.paymentKey,p);return Response.json(p)
      }
      const paymentKey=decodeURIComponent(path.split('/')[3]??''),p=providerPayments.get(paymentKey)
      if(p&&path.endsWith('/cancel')){p.status='CANCELED';return Response.json(p)}
      if(p)return Response.json(p)
      return Response.json({code:'NOT_FOUND_PAYMENT'},{status:404})
    })
    localDir=await mkdtemp(join(tmpdir(),'bandal-study-market-tus-'))
    main=createStudyMarketClient({getClient:()=>seller.client,config:()=>({url,publishableKey:key}),fetch:async(raw,init)=>{
      if(new URL(String(raw)).pathname==='/functions/v1/study-market')return handle(new Request(String(raw),init))
      const method=init?.method??'GET'
      if(interrupt&&committedChunk&&method==='PATCH'){blockedAttempts++;throw new Error('Simulated transport interruption before sending bytes')}
      const response=await fetch(raw,init),headers=new Headers(init?.headers)
      tusCalls.push({method,status:response.status,offset:response.headers.get('Upload-Offset'),metadataNames:headers.get('Upload-Metadata')?.split(',').map(value=>value.split(' ')[0]!)})
      if(interrupt&&method==='PATCH'&&!committedChunk&&response.ok){committedChunk=true;throw new Error('Simulated response loss after committing the 6 MiB chunk')}
      return response
    }})
    fileInput=[{id:crypto.randomUUID(),path:'자료.pdf',bytes:pdf.length,sha256:await sha256(pdf),mime:'application/pdf'},{id:crypto.randomUUID(),path:'미리보기.png',bytes:preview.length,sha256:await sha256(preview),mime:'image/png',preview:true}]
  },30_000)
  afterAll(async()=>{if(localDir)await rm(localDir,{recursive:true,force:true})})
  it('allows anonymous browsing, denies unauthorized writes and private DB access',async()=>{
    expect((await api('context')).status).toBe(200)
    expect((await api('saveDraft')).status).toBe(401)
    expect((await anon.from('study_market_orders').select('*')).error).toBeTruthy()
    expect((await buyer.client.from('study_market_operators').insert({user_id:buyer.id})).error).toBeTruthy()
    expect((await buyer.client.rpc('study_market_apply_payment',{})).error).toBeTruthy()
    await api('context',{universityId:'snu'},seller.token);await api('context',{universityId:'snu'},buyer.token);await api('context',{universityId:'kaist'},outsider.token)
    expect((await api('courses',{universityId:'snu'})).status).toBe(200)
    course=(await api('createCourse',{universityId:'snu',name:'자료 구조'},seller.token)).data
    expect(course.id).toBeTruthy()
  })
  it('saves unattested drafts and resumes unchanged file manifests without a new version',async()=>{
    const draft={universityId:'snu',courseId:course.id,title:'자료구조 정리',description:'직접 작성한 자료',price:1001,professor:'',semester:'2026-2',files:fileInput,rightsConfirmed:false}
    const saved=await api('saveDraft',draft,seller.token);expect(saved.status).toBe(200);listing=saved.data
    const resumed=await api('saveDraft',{...draft,id:listing.id,title:'자료구조 요약',rightsConfirmed:true},seller.token)
    expect(resumed.status).toBe(200);expect(resumed.data.versionId).toBe(listing.versionId);listing=resumed.data
    expect((await api('publish',{versionId:listing.versionId},seller.token)).status).toBe(409)
  })
  it('uploads to private staging, seals validated copies, and resists stale writes',async()=>{
    for(let i=0;i<fileInput.length;i++){
      const f=fileInput[i],grant=await api('uploadGrant',{versionId:listing.versionId,fileId:f.id},seller.token)
      expect(grant.status).toBe(200);grants.push(grant.data)
      expect(new URL(grant.data.resumableUrl).pathname).toBe('/storage/v1/upload/resumable/sign')
      const absolutePath=join(localDir,f.id);await writeFile(absolutePath,i===0?pdf:preview)
      await main.upload(listing.versionId,{...f,absolutePath})
    }
    expect(tusCalls.filter(c=>c.method==='POST').every(c=>c.status===201&&c.metadataNames?.join(',')==='bucketName,objectName,contentType')).toBe(true)
    expect(tusCalls.filter(c=>c.method==='PATCH').map(c=>[c.status,c.offset])).toEqual([[204,String(pdf.length)],[204,String(preview.length)]])
    expect((await api('uploadGrant',{versionId:listing.versionId,fileId:fileInput[0].id},seller.token)).data.alreadyVerified).toBe(true)
    const finalPath=`${listing.versionId}/${fileInput[0].id}`
    expect((await seller.client.storage.from('study-market-files').upload(finalPath,pdf,{upsert:true,contentType:'application/pdf'})).error).toBeTruthy()
    expect((await anon.storage.from('study-market-files').download(finalPath)).error).toBeTruthy()
    expect((await anon.storage.from(grants[0].bucket).uploadToSignedUrl(grants[0].objectPath,grants[0].token,new TextEncoder().encode('changed'),{upsert:true})).error).toBeTruthy()
    const contents=await admin.storage.from('study-market-files').download(finalPath)
    expect(await sha256(new Uint8Array(await contents.data!.arrayBuffer()))).toBe(fileInput[0].sha256)
    await admin.from('study_market_sellers').update({status:'APPROVED',provider_id:'seller_fixture'}).eq('user_id',seller.id)
    const result=await api('publish',{versionId:listing.versionId},seller.token);expect(result.status).toBe(200);expect(result.data.status).toBe('published')
    expect(result.data.previewUrls).toHaveLength(1)
    expect((await api('listings',{universityId:'snu'})).data.listings).toHaveLength(1)
  })
  it('freezes price/version and grants access only after verified matching payment',async()=>{
    expect((await api('order',{listingId:listing.id},outsider.token)).status).toBe(409)
    const created=await api('order',{listingId:listing.id},buyer.token);expect(created.status).toBe(200);order=created.data
    expect(order.fee).toBe(100);expect(order.sellerAmount).toBe(901)
    expect((await api('download',{orderId:order.id,acceptSupply:true},buyer.token)).status).toBe(409)
    const token=new URL(order.checkoutUrl).hash.slice('#token='.length),before=providerCalls
    expect((await api('confirmPayment',{token,orderId:order.id,paymentKey:'pay_fixture',amount:2})).status).toBe(409)
    expect(providerCalls).toBe(before)
    const paid=await api('confirmPayment',{token,orderId:order.id,paymentKey:'pay_fixture',amount:1001});expect(paid.status).toBe(200);expect(paid.data.status).toBe('paid')
    expect((await api('confirmPayment',{token,orderId:order.id,paymentKey:'pay_fixture',amount:1001})).data.status).toBe('paid')
    const ledger=await admin.from('study_market_ledger').select('*').eq('order_id',order.id);expect(ledger.data).toHaveLength(1)
    expect((await api('download',{orderId:order.id,acceptSupply:true},outsider.token)).status).toBe(404)
    const download=await api('download',{orderId:order.id,acceptSupply:true},buyer.token);expect(download.status).toBe(200);expect(download.data.files).toHaveLength(1)
    expect((await api('orderStatus',{orderId:order.id},buyer.token)).data.supplyStartedAt).toBeTruthy()
    expect((await api('refund',{orderId:order.id,reason:'자료 오류'},buyer.token)).status).toBe(200)
    expect((await admin.from('study_market_cases').select('*').eq('subject_id',order.id)).data).toHaveLength(1)
  })
  it('serializes refunds, payout reservations and append-only accounting',async()=>{
    const customer=await user('refund');await api('context',{universityId:'snu'},customer.token)
    refundOrder=(await api('order',{listingId:listing.id},customer.token)).data
    const token=new URL(refundOrder.checkoutUrl).hash.slice('#token='.length)
    await api('confirmPayment',{token,orderId:refundOrder.id,paymentKey:'pay_refund',amount:1001})
    const results=await Promise.all([api('refund',{orderId:refundOrder.id,reason:'구매 취소'},customer.token),api('refund',{orderId:refundOrder.id,reason:'구매 취소'},customer.token)])
    expect(results.every(r=>r.status===200)).toBe(true)
    const entries=await admin.from('study_market_ledger').select('*').eq('order_id',refundOrder.id)
    expect(entries.data).toHaveLength(2);expect(entries.data!.reduce((sum,r)=>sum+r.amount,0)).toBe(0)
    expect((await api('download',{orderId:refundOrder.id,acceptSupply:true},customer.token)).status).toBe(409)
    expect((await admin.from('study_market_files').update({sha256:'b'.repeat(64)}).eq('version_id',listing.versionId)).error).toBeTruthy()
    const fake=await handle(new Request(`${url}/webhook`,{method:'POST',body:JSON.stringify({eventType:'payout.changed',eventId:'forged',entityBody:{id:'payout_fake'}})}),'webhook')
    expect(fake.status).toBe(401)
  })
  it('republishes only the current immutable version and preserves the school',async()=>{
    expect((await api('withdraw',{listingId:listing.id},seller.token)).status).toBe(200)
    expect((await api('publish',{versionId:listing.versionId},seller.token)).data.status).toBe('published')
    await api('context',{universityId:'kaist'},seller.token)
    const otherCourse=(await api('createCourse',{universityId:'kaist',name:'자료 구조'},seller.token)).data
    expect((await api('saveDraft',{id:listing.id,universityId:'kaist',courseId:otherCourse.id,title:'이동',description:'다른 학교',price:1001,files:fileInput,rightsConfirmed:true},seller.token)).status).toBe(403)
    await api('context',{universityId:'snu'},seller.token)
  })
  it('records late charges without conflicting with a replacement purchase and refunds them',async()=>{
    const customer=await user('late');await api('context',{universityId:'snu'},customer.token)
    const late=(await api('order',{listingId:listing.id},customer.token)).data
    await admin.from('study_market_orders').update({checkout_expires_at:new Date(Date.now()-3600000).toISOString()}).eq('id',late.id)
    const replacement=await api('order',{listingId:listing.id},customer.token);expect(replacement.status).toBe(200)
    providerPayments.set('pay_late',{orderId:late.id,paymentKey:'pay_late',totalAmount:1001,currency:'KRW',status:'DONE',approvedAt:new Date().toISOString()})
    const delivered=await handle(new Request(`${url}/webhook`,{method:'POST',body:JSON.stringify({eventType:'PAYMENT_STATUS_CHANGED',data:{orderId:late.id,paymentKey:'pay_late'}})}),'webhook')
    expect(delivered.status).toBe(200)
    expect((await admin.from('study_market_orders').select('status,payment_key').eq('id',late.id).single()).data).toMatchObject({status:'refund_due',payment_key:'pay_late'})
    expect((await api('refund',{orderId:late.id,reason:'만료 결제'},customer.token)).data.status).toBe('refunded')
    expect((await admin.from('study_market_ledger').select('*').eq('order_id',late.id)).data).toHaveLength(0)
    expect((await admin.from('study_market_orders').select('status').eq('id',replacement.data.id).single()).data!.status).toBe('pending')
  })
  it('serializes download consent with a concurrent refund',async()=>{
    const customer=await user('supply-race');await api('context',{universityId:'snu'},customer.token)
    const created=(await api('order',{listingId:listing.id},customer.token)).data
    await api('confirmPayment',{token:new URL(created.checkoutUrl).hash.slice(7),orderId:created.id,paymentKey:'pay_supply_race',amount:1001})
    const [download]=await Promise.all([api('download',{orderId:created.id,acceptSupply:true},customer.token),api('refund',{orderId:created.id,reason:'동시 취소'},customer.token)])
    const row=(await admin.from('study_market_orders').select('status,downloaded_at').eq('id',created.id).single()).data!
    if(row.status==='refunded'){expect(download.status).toBe(409);expect(row.downloaded_at).toBeNull()}
    else {expect(download.status).toBe(200);expect(row.status).toBe('review');expect(row.downloaded_at).toBeTruthy()}
  })
  it('reserves one exact ledger set under concurrent settlement and refund',async()=>{
    const customer=await user('payout-race');await api('context',{universityId:'snu'},customer.token)
    const created=(await api('order',{listingId:listing.id},customer.token)).data
    await api('confirmPayment',{token:new URL(created.checkoutUrl).hash.slice(7),orderId:created.id,paymentKey:'pay_payout_race',amount:1001})
    await admin.from('study_market_operators').insert({user_id:customer.id})
    await admin.from('study_market_ledger').update({available_at:new Date(Date.now()-86400000).toISOString()}).eq('seller_id',seller.id)
    const date=new Date().toISOString().slice(0,10)
    await admin.from('study_market_calendar_years').upsert({year:Number(date.slice(0,4)),source:'isolated test fixture'})
    await admin.from('study_market_business_days').upsert({date,is_business_day:true,source:'isolated test fixture'})
    const [reserved,refunding]=await Promise.all([
      admin.rpc('study_market_reserve_payout',{seller_input:seller.id,date_input:date,env:'test'}),
      admin.rpc('study_market_begin_refund',{actor:customer.id,order_input:created.id,reason_input:'동시 정산 취소'})
    ])
    if(reserved.data?.id){
      expect(refunding.error?.message).toBe('payout_in_progress')
      const entries=(await admin.from('study_market_ledger').select('amount').eq('payout_id',reserved.data.id)).data!
      expect(entries.reduce((n,e)=>n+e.amount,0)).toBe(Number(reserved.data.amount))
      const again=await admin.rpc('study_market_reserve_payout',{seller_input:seller.id,date_input:date,env:'test'});expect(again.data.id).toBe(reserved.data.id)
    }else{expect(refunding.error).toBeNull();expect(refunding.data.status).toBe('refund_pending')}
  })
  it('resumes real signed TUS after losing a committed chunk response and restarting upload',async()=>{
    const bytes=new Uint8Array(7*1024*1024+123);bytes.fill(65);bytes.set(new TextEncoder().encode('%PDF-1.7\n'))
    const file={id:crypto.randomUUID(),path:'large.pdf',bytes:bytes.length,sha256:await sha256(bytes),mime:'application/pdf'}
    const absolutePath=join(localDir,file.id);await writeFile(absolutePath,bytes)
    const saved=await main.request('saveDraft',{universityId:'snu',courseId:course.id,title:'큰 자료',description:'실제 TUS 재개 검사',price:1000,rightsConfirmed:false,files:[file]})
    const start=tusCalls.length
    interrupt=true
    await expect(main.upload(saved.versionId,{...file,absolutePath})).rejects.toThrow('자료 업로드가 중단')
    expect(committedChunk).toBe(true);expect(blockedAttempts).toBe(3)
    expect(tusCalls.slice(start).some(c=>c.method==='HEAD'&&c.status===200&&c.offset===String(6*1024*1024))).toBe(true)
    interrupt=false
    await main.upload(saved.versionId,{...file,absolutePath})
    const calls=tusCalls.slice(start)
    expect(calls.filter(c=>c.method==='POST')).toHaveLength(1)
    expect(calls.filter(c=>c.method==='PATCH').map(c=>[c.status,c.offset])).toEqual([[204,String(6*1024*1024)],[204,String(bytes.length)]])
    const result=await admin.storage.from('study-market-files').download(`${saved.versionId}/${file.id}`)
    expect(result.error).toBeNull();expect(await sha256(new Uint8Array(await result.data!.arrayBuffer()))).toBe(file.sha256)
  })
  it('enforces account draft quotas atomically under concurrent creation',async()=>{
    const bytes=50*1024*1024,large=Array.from({length:20},(_,i)=>({...fileInput[0],id:crypto.randomUUID(),path:`quota-${i}.pdf`,bytes}))
    const first=await admin.rpc('study_market_create_version',{actor:seller.id,listing_input:listing.id,files_input:large,attested:false})
    expect(first.error).toBeNull()
    const attempts=await Promise.all([1,2].map(()=>admin.rpc('study_market_create_version',{actor:seller.id,listing_input:listing.id,files_input:[{...fileInput[0],id:crypto.randomUUID(),bytes}],attested:false})))
    expect(attempts.every(r=>r.error?.message==='upload_quota_exceeded')).toBe(true)
  })

})
