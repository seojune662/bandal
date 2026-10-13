import { describe,expect,it } from 'vitest'
import JSZip from 'jszip'
import { inspectBytes,validateFiles,sha256,settlementDue,LIMITS } from '../../../supabase/functions/_shared/study-market/policy'
import { encryptJwe,decryptJwe,verifyWebhook,createToss } from '../../../supabase/functions/_shared/study-market/toss'
import { paymentConfigured } from '../../../supabase/functions/_shared/study-market/service'

const id='a351f1c6-2a38-4c85-915e-76ac91e83733',hash='a'.repeat(64)
describe('study market file trust boundary',()=>{
  const valid={id,path:'자료/정리.md',bytes:30,sha256:hash,mime:'ignored'}
  it('canonicalizes the MIME and rejects path, duplicate, size and preview attacks',()=>{
    expect(validateFiles([valid])[0]?.mime).toBe('text/markdown')
    for(const path of ['../a.pdf','/tmp/a.pdf','x/../a.pdf','x\\a.pdf','C:/a.pdf','.bandal/a.pdf','a.exe','a.docm'])expect(()=>validateFiles([{...valid,path}])).toThrow()
    expect(()=>validateFiles([valid,{...valid,id:'b351f1c6-2a38-4c85-915e-76ac91e83733'}])).toThrow()
    expect(()=>validateFiles([{...valid,bytes:LIMITS.file+1}])).toThrow()
    expect(()=>validateFiles([{...valid,preview:true}])).toThrow()
  })
  it('checks actual bytes rather than trusting PDF extension or uploaded MIME',async()=>{
    expect(()=>inspectBytes('a.pdf',new TextEncoder().encode('<script>evil</script>'))).toThrow('file_content_mismatch')
    expect(()=>inspectBytes('a.txt',new Uint8Array([0xff,0xfe]))).toThrow()
    expect(()=>inspectBytes('a.pdf',new TextEncoder().encode('%PDF-1.7\n'))).not.toThrow()
    expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('rejects macro/embedded executables and spoofed OOXML containers',async()=>{
    const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<document/>')
    expect(()=>inspectBytes('a.docx',new Uint8Array(0))).toThrow()
    expect(()=>inspectBytes('a.docx',Buffer.from('PK'))).toThrow()
    const clean=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
    expect(()=>inspectBytes('a.docx',clean)).not.toThrow()
    expect(()=>inspectBytes('a.xlsx',clean)).toThrow()
    zip.file('word/vbaProject.bin',new Uint8Array([1]))
    expect(()=>inspectBytes('a.docx',clean.subarray(0,clean.length-5))).toThrow()
    const macro=await zip.generateAsync({type:'uint8array'})
    expect(()=>inspectBytes('a.docx',macro)).toThrow('active_office_content')
  })
})
describe('settlement banking calendar',()=>{
  it('requires Friday noon KST and a verified complete calendar',()=>{
    const days=new Map([['2026-10-16',true]])
    expect(settlementDue(new Date('2026-10-16T02:59:59Z'),days)).toBe(false)
    expect(settlementDue(new Date('2026-10-16T03:00:00Z'),days)).toBe(true)
    expect(settlementDue(new Date('2026-10-16T06:00:00Z'),days)).toBe(false)
    expect(settlementDue(new Date('2026-10-16T03:00:00Z'),new Map())).toBe(false)
  })
  it('defers a Friday holiday across the weekend to verified Monday',()=>{
    const days=new Map([['2026-10-16',false],['2026-10-17',false],['2026-10-18',false],['2026-10-19',true]])
    expect(settlementDue(new Date('2026-10-19T03:00:00Z'),days)).toBe(true)
    days.delete('2026-10-18');expect(settlementDue(new Date('2026-10-19T03:00:00Z'),days)).toBe(false)
  })
})
describe('Toss encrypted financial boundary',()=>{
  const key='01'.repeat(32)
  it('roundtrips dir/A256GCM with mandatory nonce/iat and rejects tampering',async()=>{
    const payload={account:{accountNumber:'123456789'}},encrypted=await encryptJwe(payload,key)
    expect(await decryptJwe(encrypted,key)).toEqual(payload)
    const header=JSON.parse(Buffer.from(encrypted.split('.')[0]!,'base64url').toString())
    expect(header).toMatchObject({alg:'dir',enc:'A256GCM'});expect(header.nonce).toMatch(/^[a-f0-9-]{36}$/)
    const parts=encrypted.split('.');parts[3]=`Z${parts[3]!.slice(1)}`
    await expect(decryptJwe(parts.join('.'),key)).rejects.toThrow()
    await expect(decryptJwe(encrypted,'02'.repeat(32))).rejects.toThrow()
  })
  it('validates raw webhook bytes, timestamp and rotated signatures',async()=>{
    const now=new Date('2026-10-13T00:00:00Z'),raw='{"eventType":"payout.changed"}',time=now.toISOString()
    const hmac=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign'])
    const sig=Buffer.from(await crypto.subtle.sign('HMAC',hmac,new TextEncoder().encode(`${raw}:${time}`))).toString('base64')
    const headers=new Headers({'tosspayments-webhook-transmission-time':time,'tosspayments-webhook-signature':`v1:aaaa,v1:${sig}`})
    expect(await verifyWebhook(raw,headers,key,now)).toBe(true)
    expect(await verifyWebhook(`${raw} `,headers,key,now)).toBe(false)
    expect(await verifyWebhook(raw,headers,key,new Date(now.getTime()+301000))).toBe(false)
  })
  it('fails closed with disabled/mismatched environment and never sends wrong-mode keys',async()=>{
    const c={environment:'live' as const,enabled:false,clientKey:'live_ck_x',secretKey:'live_sk_x',payoutSecretKey:'live_sk_y',securityKey:key,cronSecret:'',supabaseUrl:'https://example.supabase.co',webOrigin:'https://bandal.io'}
    expect(paymentConfigured(c)).toBe(false)
    expect(paymentConfigured({...c,enabled:true})).toBe(true)
    expect(paymentConfigured({...c,enabled:true,secretKey:'test_sk_x'})).toBe(false)
    const gateway=createToss({...c,secretKey:'test_sk_x'},async()=>{throw new Error('must not call')})
    await expect(gateway.confirm(id,'key',1000)).rejects.toThrow('payment_not_configured')
  })
})
