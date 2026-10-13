import { base64url, equalBytes, MarketError } from './policy.ts'

export interface TossConfig { secretKey: string; payoutSecretKey: string; securityKey: string; environment: 'test' | 'live' }
type Json = Record<string, unknown>
function decode64(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0))
}
function securityBytes(key: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new MarketError('payout_security_not_configured',503)
  return Uint8Array.from(key.match(/../g)!, x=>parseInt(x,16))
}
export async function encryptJwe(body: unknown, key: string, now=new Date()): Promise<string> {
  const header=base64url(new TextEncoder().encode(JSON.stringify({alg:'dir',enc:'A256GCM',iat:now.toISOString().replace(/\.\d{3}Z$/,'+00:00'),nonce:crypto.randomUUID()})))
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey=await crypto.subtle.importKey('raw',securityBytes(key) as BufferSource,'AES-GCM',false,['encrypt'])
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(header),tagLength:128},cryptoKey,new TextEncoder().encode(JSON.stringify(body))))
  return `${header}..${base64url(iv)}.${base64url(ciphertext.subarray(0,-16))}.${base64url(ciphertext.subarray(-16))}`
}
export async function decryptJwe(token: string, key: string): Promise<unknown> {
  const p=token.split('.')
  if(p.length!==5 || p[1]!=='' || !p[0] || !p[2] || !p[3] || !p[4]) throw new MarketError('invalid_provider_encryption',502)
  const header=JSON.parse(new TextDecoder().decode(decode64(p[0]))) as Json
  if(header.alg!=='dir'||header.enc!=='A256GCM') throw new MarketError('invalid_provider_encryption',502)
  const encrypted=decode64(p[3]),tag=decode64(p[4]),iv=decode64(p[2])
  if(tag.length!==16||iv.length!==12) throw new MarketError('invalid_provider_encryption',502)
  const all=new Uint8Array(encrypted.length+tag.length);all.set(encrypted);all.set(tag,encrypted.length)
  const cryptoKey=await crypto.subtle.importKey('raw',securityBytes(key) as BufferSource,'AES-GCM',false,['decrypt'])
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv as BufferSource,additionalData:new TextEncoder().encode(p[0]),tagLength:128},cryptoKey,all)
  return JSON.parse(new TextDecoder().decode(plaintext))
}
/** The provider signs raw UTF-8 body:transmission-time; do not reserialize JSON. */
export async function verifyWebhook(raw: string, headers: Headers, key: string, now=new Date()): Promise<boolean> {
  if(!/^[a-f0-9]{64}$/i.test(key))return false
  const time=headers.get('tosspayments-webhook-transmission-time')
  if(!time || !Number.isFinite(Date.parse(time)) || Math.abs(now.getTime()-Date.parse(time))>5*60_000) return false
  const values=[...(headers.get('tosspayments-webhook-signature')??'').matchAll(/v1:([A-Za-z0-9+/=_-]+)/g)].slice(0,4)
  if(!values.length) return false
  const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(`${raw}:${time}`)))
  return values.some(value=>{try{return equalBytes(signature,decode64(value[1]!))}catch{return false}})
}
export function unwrap(value: unknown): Json {
  if(!value || typeof value!=='object'||Array.isArray(value)) throw new MarketError('invalid_provider_response',502)
  const outer=value as Json
  return (outer.entityBody && typeof outer.entityBody==='object' ? outer.entityBody : outer) as Json
}
export function createToss(config: TossConfig, fetcher: typeof fetch=fetch) {
  const prefix=`${config.environment}_`
  const assertKeys=(payout: boolean) => {
    if(!(payout?config.payoutSecretKey:config.secretKey).startsWith(prefix)) throw new MarketError('payment_not_configured',503)
    if(payout) securityBytes(config.securityKey)
  }
  async function request(path:string,body?:unknown,idempotencyKey?:string,payout=false):Promise<Json> {
    assertKeys(payout)
    const encrypted=payout&&body!==undefined
    const response=await fetcher(`https://api.tosspayments.com${path}`,{
      method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(25_000),
      headers:{Authorization:`Basic ${btoa(`${payout?config.payoutSecretKey:config.secretKey}:`)}`,'Content-Type':encrypted?'text/plain':'application/json',
        ...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}),...(encrypted?{'TossPayments-api-security-mode':'ENCRYPTION'}:{})},
      ...(body===undefined?{}:{body:encrypted?await encryptJwe(body,config.securityKey):JSON.stringify(body)})
    })
    const raw=await response.text()
    if(raw.length>1024*1024) throw new MarketError('invalid_provider_response',502)
    let data:Json
    try{data=unwrap(encrypted?await decryptJwe(raw,config.securityKey):JSON.parse(raw))}catch{throw new MarketError('invalid_provider_response',502)}
    const errorCode=(data.error as Json|undefined)?.code??data.code
    if(!response.ok) throw new MarketError(typeof errorCode==='string'?`provider_${errorCode}`:'provider_error',502)
    return data
  }
  return {
    payment:(key:string)=>request(`/v1/payments/${encodeURIComponent(key)}`),
    paymentByOrder:(id:string)=>request(`/v1/payments/orders/${encodeURIComponent(id)}`),
    confirm:(id:string,key:string,amount:number)=>request('/v1/payments/confirm',{orderId:id,paymentKey:key,amount},`confirm-${id}`),
    cancel:(key:string,reason:string,id:string)=>request(`/v1/payments/${encodeURIComponent(key)}/cancel`,{cancelReason:reason},id),
    registerSeller:(body:unknown,id:string)=>request('/v2/sellers',body,id,true),
    seller:(id:string)=>request(`/v2/sellers/${encodeURIComponent(id)}`,undefined,undefined,true),
    balance:()=>request('/v2/balances',undefined,undefined,true),
    payout:(id:string)=>request(`/v2/payouts/${encodeURIComponent(id)}`,undefined,undefined,true),
    requestPayout:async(id:string,seller:string,amount:number)=>{
      const result=await request('/v2/payouts',[{refPayoutId:id,destination:seller,scheduleType:'EXPRESS',amount:{currency:'KRW',value:amount},transactionDescription:'반달정산'}],`payout-${id}`,true)
      if(!Array.isArray(result.items)||result.items.length!==1) throw new MarketError('invalid_provider_response',502)
      return unwrap(result.items[0])
    }
  }
}
