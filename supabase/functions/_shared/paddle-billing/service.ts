import type { SupabaseClient } from '@supabase/supabase-js'
import { BillingError, SANDBOX_PRICES, boundedBody, eventDigest, identifier, object, paidTransaction, planFromItems, sha256, subscriptionSnapshot, timestamp, uuid, verifySignature, type JsonObject, type PaymentSnapshot, type Plan, type SubscriptionSnapshot } from './policy.ts'
import { createPaddleProvider, type PaddleProvider } from './provider.ts'

export interface BillingConfig {
  enabled: boolean; environment: string; webOrigin: string; supabaseUrl: string; supabaseAnonKey: string;
  apiKey: string; clientToken: string; webhookSecret: string; allowedUserIds: string[]
}
export function configured(config: BillingConfig): boolean {
  return config.enabled && config.environment === 'sandbox' && /^pdl_sdbx_apikey_[A-Za-z0-9_-]+$/.test(config.apiKey) && /^test_[A-Za-z0-9]+$/.test(config.clientToken) && /^pdl_ntfset_[A-Za-z0-9_+/-]+={0,2}$/.test(config.webhookSecret)
}
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    const safe = ['subscription_exists', 'checkout_plan_already_pending', 'request_id_reused', 'checkout_binding_pending', 'checkout_binding_mismatch', 'customer_binding_mismatch', 'subscription_mismatch', 'payment_mismatch', 'event_payload_mismatch', 'checkout_not_ready']
    throw new BillingError(safe.includes(result.error.message) ? result.error.message : 'billing_storage_unavailable', result.error.message === 'checkout_binding_pending' ? 503 : 409)
  }
  return result.data
}
const subscriptionEvents = new Set(['subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.canceled', 'subscription.paused', 'subscription.resumed', 'subscription.past_due', 'subscription.trialing'])

export function createBillingService(db: SupabaseClient, config: BillingConfig, provider: PaddleProvider = createPaddleProvider(config.apiKey), clock = () => new Date()) {
  const table = (name: string) => db.from(`paddle_billing_${name}`)
  const rpc = async (name: string, args: JsonObject): Promise<unknown> => checked(await db.rpc(`paddle_billing_${name}`, args))
  async function status(userId: string) {
    return { environment: 'sandbox', enabled: true, entitlement: await rpc('status', { actor: userId, env: 'sandbox' }) }
  }
  async function actor(request: Request): Promise<string> {
    const auth = request.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ') || auth.length > 16384) throw new BillingError('sign_in_required', 401)
    const { data, error } = await db.auth.getUser(auth.slice(7))
    if (error || !data.user) throw new BillingError('sign_in_required', 401)
    if (!config.allowedUserIds.includes(data.user.id)) throw new BillingError('sandbox_tester_required', 403)
    return data.user.id
  }
  async function applyEvent(eventId: string, type: string, occurredAt: string, hash: string, subscription: SubscriptionSnapshot | null, payment: PaymentSnapshot | null, originTransaction: string | null = null) {
    return rpc('apply_event', { env: 'sandbox', event_input: eventId, event_type_input: type, occurred_input: occurredAt, hash_input: hash, subscription_input: subscription, payment_input: payment, origin_transaction_input: originTransaction })
  }
  async function checkout(input: JsonObject, userId: string) {
    if (input.plan !== 'monthly' && input.plan !== 'annual') throw new BillingError('invalid_plan')
    const plan: Plan = input.plan, requestId = uuid(input.requestId)
    // Extra fields (price, customer, amount, custom_data, URLs) are deliberately
    // rejected instead of being forwarded into the provider API.
    if (Object.keys(input).some(key => !['action', 'plan', 'requestId'].includes(key))) throw new BillingError('invalid_checkout_request')
    const reserved = object(await rpc('reserve_checkout', { actor: userId, plan_input: plan, request_key: requestId, env: 'sandbox' }))
    if (reserved.state === 'completed') throw new BillingError('subscription_exists', 409)
    if (reserved.state === 'failed') throw new BillingError('checkout_failed_retry_new_request', 409)
    let transactionId: string
    if (reserved.created === true) {
      try {
        const customer = checked(await table('customers').select('customer_id').eq('environment', 'sandbox').eq('user_id', userId).maybeSingle())
        const transaction = await provider.createTransaction(SANDBOX_PRICES[plan].id, customer?.customer_id ?? null, `${config.webOrigin}/billing/sandbox`)
        transactionId = identifier(transaction.id, 'txn')
        if (planFromItems(transaction.items) !== plan || transaction.currency_code !== 'KRW' || transaction.collection_mode !== 'automatic' || !['draft', 'ready'].includes(String(transaction.status)) || transaction.discount_id != null || (transaction.customer_id ?? null) !== (customer?.customer_id ?? null)) throw new BillingError('checkout_binding_mismatch', 409)
        await rpc('bind_checkout', { checkout_input: reserved.id, transaction_input: transactionId, env: 'sandbox' })
      } catch (error) {
        // An ambiguous provider timeout never returns a transaction to a client.
        // Fail this attempt closed; a fresh requestId may start a new attempt.
        await table('checkouts').update({ state: 'failed' }).eq('id', reserved.id).eq('state', 'creating')
        throw error
      }
    } else {
      if (reserved.state !== 'ready' || !reserved.transaction_id) throw new BillingError('checkout_creation_pending', 409)
      transactionId = identifier(reserved.transaction_id, 'txn')
      const transaction = await provider.transaction(transactionId)
      if (transaction.status === 'completed') throw new BillingError('payment_processing', 409)
      if (!['draft', 'ready', 'past_due'].includes(String(transaction.status)) || planFromItems(transaction.items) !== plan) throw new BillingError('checkout_not_ready', 409)
    }
    return { environment: 'sandbox', transactionId, clientToken: config.clientToken }
  }
  async function cancel(userId: string) {
    const rows = checked(await table('subscriptions').select('subscription_id,customer_id,price_id,status').eq('environment', 'sandbox').eq('user_id', userId).in('status', ['active', 'past_due']).order('created_at', { ascending: false }).limit(1))
    const stored = rows?.[0]
    if (!stored) throw new BillingError('subscription_not_found', 404)
    let snapshot = subscriptionSnapshot(await provider.subscription(stored.subscription_id))
    if (snapshot.id !== stored.subscription_id || snapshot.customer_id !== stored.customer_id || snapshot.price_id !== stored.price_id) throw new BillingError('subscription_mismatch', 409)
    if (snapshot.status === 'active' || snapshot.status === 'past_due') {
      if (snapshot.scheduled_action !== 'cancel') snapshot = subscriptionSnapshot(await provider.cancel(stored.subscription_id))
      if (snapshot.scheduled_action !== 'cancel' || snapshot.id !== stored.subscription_id || snapshot.customer_id !== stored.customer_id || snapshot.price_id !== stored.price_id) throw new BillingError('subscription_mismatch', 409)
    }
    const now = clock().toISOString(), serialized = new TextEncoder().encode(JSON.stringify(snapshot))
    // Authenticated provider mutation responses use the same monotonic SQL
    // transition as webhooks, with a separate server-generated receipt namespace.
    await applyEvent(`api_cancel_${crypto.randomUUID()}`, 'api.cancel', now, await sha256(serialized), snapshot, null)
    return status(userId)
  }
  async function webhook(request: Request) {
    const raw = await boundedBody(request, 262144)
    await verifySignature(raw, request.headers.get('paddle-signature'), config.webhookSecret, clock().getTime())
    let event: JsonObject
    try { event = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))) } catch { throw new BillingError('invalid_event', 400) }
    const eventId = identifier(event.event_id, 'evt'), type = String(event.event_type), occurredAt = timestamp(event.occurred_at)
    if (!subscriptionEvents.has(type) && type !== 'transaction.completed') return { received: true, ignored: true }
    const hash = await eventDigest(event), data = object(event.data)
    // Database-only processing keeps acknowledgement within Paddle's 5 seconds.
    // No customer/email/custom_data matching or network reads occur here.
    if (type === 'transaction.completed') {
      const payment = paidTransaction(data)
      await applyEvent(eventId, type, occurredAt, hash, null, payment)
    } else {
      const snapshot = subscriptionSnapshot(data)
      const origin = type === 'subscription.created' ? identifier(data.transaction_id, 'txn') : null
      await applyEvent(eventId, type, occurredAt, hash, snapshot, null, origin)
    }
    return { received: true }
  }
  return async (request: Request, route: 'api' | 'webhook' = 'api'): Promise<Response> => {
    const origin = request.headers.get('origin'), headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' }
    if (origin === config.webOrigin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type,apikey,x-client-info', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' })
    const respond = (body: unknown, code = 200) => Response.json(body, { status: code, headers })
    try {
      if (route === 'api' && origin && origin !== config.webOrigin) throw new BillingError('origin_not_allowed', 403)
      if (route === 'api' && request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (route === 'api' && request.method === 'GET' && new URL(request.url).searchParams.get('action') === 'config') {
        const enabled = configured(config)
        return respond({ environment: 'sandbox', enabled, supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, clientToken: enabled ? config.clientToken : '' })
      }
      if (request.method !== 'POST') throw new BillingError('method_not_allowed', 405)
      if (!configured(config)) throw new BillingError('billing_not_configured', 503)
      if (route === 'webhook') return respond(await webhook(request))
      const userId = await actor(request)
      let input: JsonObject
      try { input = object(JSON.parse(new TextDecoder().decode(await boundedBody(request, 4096)))) } catch (error) {
        if (error instanceof BillingError && error.code === 'body_too_large') throw error
        throw new BillingError('invalid_request')
      }
      if (input.action === 'status') return respond(await status(userId))
      if (input.action === 'checkout') return respond(await checkout(input, userId))
      if (input.action === 'cancel') return respond(await cancel(userId))
      throw new BillingError('unknown_action')
    } catch (error) {
      return respond({ error: error instanceof BillingError ? error.code : 'billing_unavailable' }, error instanceof BillingError ? error.status : 503)
    }
  }
}
