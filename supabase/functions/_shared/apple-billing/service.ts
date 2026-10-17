import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppleProvider } from './provider.ts'
import { AppleBillingError, body, configured, digest, identifier, object, token, type AppleConfig, type Json } from './policy.ts'
const safe = new Set(['subscription_exists','checkout_in_progress','purchase_owned_by_another_account','apple_account_token_required','apple_transaction_mismatch','event_payload_mismatch','account_deleted'])
export function createAppleBillingService(db: SupabaseClient, c: AppleConfig, provider: AppleProvider | null) {
  async function checked<T>(result: { data: T; error: { message: string } | null }): Promise<T> {
    if (result.error) throw new AppleBillingError(safe.has(result.error.message) ? result.error.message : 'apple_billing_unavailable', safe.has(result.error.message) ? 409 : 503)
    return result.data
  }
  async function rpc(name: string, args: Json) { return checked(await db.rpc(name, args)) }
  async function status(actor: string) {
    return { subscription: await rpc('bandal_subscription_status_for', { actor }), sync: await rpc('bandal_sync_status_for', { actor }) }
  }
  async function own(actor: string, accountToken: string) {
    const account = await checked(await db.from('apple_billing_accounts').select('user_id').eq('app_account_token', accountToken).maybeSingle())
    if (!account) throw new AppleBillingError('apple_account_token_required', 409)
    if (!account.user_id || account.user_id !== actor) throw new AppleBillingError('purchase_owned_by_another_account', 409)
  }
  async function apply(actor: string | null, eventId: string, hash: string, value: Json | null) {
    return rpc('apple_billing_apply', { actor, env: c.environment, event_input: eventId, hash_input: hash, snapshot: value })
  }
  return async (request: Request, route: 'api' | 'webhook' = 'api'): Promise<Response> => {
    const origin = request.headers.get('origin'), headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' }
    if (origin === c.webOrigin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type,apikey,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' })
    const respond = (value: unknown, status = 200) => Response.json(value, { status, headers })
    try {
      if (route === 'api' && origin && origin !== c.webOrigin) throw new AppleBillingError('origin_not_allowed', 403)
      if (route === 'api' && request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (request.method !== 'POST') throw new AppleBillingError('method_not_allowed', 405)
      // Disabling new sales must not interrupt verification, restore or refunds.
      if (!configured(c) || !provider) throw new AppleBillingError('apple_billing_unavailable', 503)
      if (route === 'webhook') {
        const input = await body(request)
        if (Object.keys(input).some(key => key !== 'signedPayload') || typeof input.signedPayload !== 'string') throw new AppleBillingError('invalid_request')
        const event = await provider.notification(input.signedPayload)
        if (typeof event.notificationUUID !== 'string' || !/^[\da-f-]{36}$/i.test(event.notificationUUID)) throw new AppleBillingError('invalid_apple_data', 502)
        const hash = await digest(input.signedPayload)
        if (event.notificationType === 'TEST') {
          await apply(null, event.notificationUUID, hash, null); return respond({ received: true })
        }
        const data = object(event.data)
        if (typeof data.signedTransactionInfo !== 'string') { await apply(null, event.notificationUUID, hash, null); return respond({ received: true, ignored: true }) }
        const transaction = await provider.transaction(data.signedTransactionInfo)
        const value = await provider.current(identifier(transaction.originalTransactionId))
        // Apple current state may not change the owner of the signed event.
        if (token(value.appAccountToken) !== token(transaction.appAccountToken)) throw new AppleBillingError('purchase_owned_by_another_account', 409)
        await apply(null, event.notificationUUID, hash, value)
        return respond({ received: true })
      }
      const authorization = request.headers.get('authorization') ?? ''
      if (!authorization.startsWith('Bearer ') || authorization.length > 16384) throw new AppleBillingError('sign_in_required', 401)
      const auth = await db.auth.getUser(authorization.slice(7))
      if (auth.error || !auth.data.user) throw new AppleBillingError('sign_in_required', 401)
      const actor = auth.data.user.id
      if (c.environment === 'sandbox' && !c.allowedUserIds.includes(actor)) throw new AppleBillingError('sandbox_tester_required', 403)
      const input = await body(request)
      if (Object.keys(input).some(key => !['action', ...(input.action === 'verify' ? ['signedTransaction'] : [])].includes(key))) throw new AppleBillingError('invalid_request')
      if (input.action === 'prepare') {
        if (!c.enabled) throw new AppleBillingError('apple_billing_unavailable', 503)
        const appAccountToken = await rpc('apple_billing_prepare', { actor, env: c.environment })
        return respond({ ...await status(actor), appAccountToken, productIds: c.productIds })
      }
      if (input.action === 'verify') {
        if (typeof input.signedTransaction !== 'string' || !input.signedTransaction) throw new AppleBillingError('invalid_request')
        const transaction = await provider.transaction(input.signedTransaction)
        await own(actor, token(transaction.appAccountToken))
        const value = await provider.current(identifier(transaction.originalTransactionId))
        await own(actor, token(value.appAccountToken))
        if (value.appAccountToken !== transaction.appAccountToken) throw new AppleBillingError('purchase_owned_by_another_account', 409)
        await apply(actor, `verify_${crypto.randomUUID()}`, await digest(JSON.stringify(value)), value)
        return respond(await status(actor))
      }
      if (input.action === 'refresh') {
        const account = await checked(await db.from('apple_billing_accounts').select('app_account_token').eq('user_id', actor).maybeSingle())
        if (account) {
          const rows = await checked(await db.from('apple_billing_subscriptions').select('original_transaction_id').eq('app_account_token', account.app_account_token).eq('environment', c.environment).limit(20))
          for (const row of rows ?? []) {
            const value = await provider.current(identifier(row.original_transaction_id))
            await own(actor, token(value.appAccountToken))
            await apply(actor, `refresh_${crypto.randomUUID()}`, await digest(JSON.stringify(value)), value)
          }
        }
        return respond(await status(actor))
      }
      throw new AppleBillingError('invalid_request')
    } catch (error) {
      return respond({ error: error instanceof AppleBillingError ? error.code : 'apple_billing_unavailable' }, error instanceof AppleBillingError ? error.status : 503)
    }
  }
}
