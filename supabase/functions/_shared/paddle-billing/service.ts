import type { SupabaseClient } from '@supabase/supabase-js'
import { BillingError, SANDBOX_PRICES, adjustmentSnapshot, boundedBody, eventDigest, identifier, object, paidTransaction, planFromItems, sha256, subscriptionSnapshot, timestamp, uuid, verifySignature, webhookEventIdentifier, type JsonObject, type PaymentSnapshot, type Plan, type SubscriptionSnapshot, type PriceCatalog } from './policy.ts'
import { createPaddleProvider, type PaddleProvider } from './provider.ts'

export interface BillingConfig {
  enabled: boolean; environment: string; webOrigin: string; supabaseUrl: string; supabaseAnonKey: string;
  apiKey: string; clientToken: string; webhookSecret: string; allowedUserIds: string[]; prices?: PriceCatalog; publicCheckout?: boolean; checkoutAllowedUserIds?: string[]
}
export function credentialsConfigured(config: BillingConfig): boolean {
  const prices = config.prices ?? SANDBOX_PRICES
  const environmentMatches = config.environment === 'sandbox'
    ? /^pdl_sdbx_apikey_[A-Za-z0-9_-]+$/.test(config.apiKey) && /^test_[A-Za-z0-9]+$/.test(config.clientToken)
    : config.environment === 'live' && /^pdl_live_apikey_[A-Za-z0-9_-]+$/.test(config.apiKey) && /^live_[A-Za-z0-9]+$/.test(config.clientToken)
      && Boolean(config.prices) && Object.values(prices).every(price => !Object.values(SANDBOX_PRICES).some(sandbox => sandbox.id === price.id))
  return environmentMatches && /^pdl_ntfset_[A-Za-z0-9_+/-]+={0,2}$/.test(config.webhookSecret)
    && /^pri_[a-z0-9]{26}$/.test(prices.monthly.id) && /^pri_[a-z0-9]{26}$/.test(prices.annual.id) && prices.monthly.id !== prices.annual.id
    && prices.monthly.amount === 4900 && prices.annual.amount === 49000 && prices.monthly.interval === 'month' && prices.annual.interval === 'year'
}
export function configured(config: BillingConfig): boolean { return config.enabled && credentialsConfigured(config) }

function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    const safe = ['subscription_exists', 'checkout_plan_already_pending', 'request_id_reused', 'checkout_binding_pending', 'checkout_binding_mismatch', 'customer_binding_mismatch', 'subscription_mismatch', 'payment_mismatch', 'event_payload_mismatch', 'checkout_not_ready', 'adjustment_binding_pending', 'adjustment_mismatch']
    throw new BillingError(safe.includes(result.error.message) ? result.error.message : 'billing_storage_unavailable', ['checkout_binding_pending', 'adjustment_binding_pending'].includes(result.error.message) ? 503 : 409)
  }
  return result.data
}
const subscriptionEvents = new Set(['subscription.created', 'subscription.activated', 'subscription.updated', 'subscription.canceled', 'subscription.paused', 'subscription.resumed', 'subscription.past_due', 'subscription.trialing'])

export function createBillingService(db: SupabaseClient, config: BillingConfig, provider: PaddleProvider = createPaddleProvider(config.apiKey, fetch, config.environment === 'live' ? 'live' : 'sandbox'), clock = () => new Date()) {
  const env = config.environment, prices = config.prices ?? SANDBOX_PRICES
  const table = (name: string) => db.from(`paddle_billing_${name}`)
  const rpc = async (name: string, args: JsonObject): Promise<unknown> => checked(await db.rpc(`paddle_billing_${name}`, args))
  const mayCheckout = (userId: string) => env !== 'live' || config.publicCheckout === true || (config.checkoutAllowedUserIds ?? []).includes(userId)
  async function status(userId: string) {
    const customer = checked(await table('customers').select('customer_id').eq('environment', env).eq('user_id', userId).maybeSingle())
    const sync = env === 'live' ? checked(await db.rpc('bandal_sync_status_for', { actor: userId })) : undefined
    return { paddleCustomerId: customer ? identifier(customer.customer_id, 'ctm') : null, environment: env, enabled: configured(config) && mayCheckout(userId), entitlement: await rpc('status', { actor: userId, env }), ...(sync ? { sync } : {}) }
  }
  async function actor(request: Request): Promise<string> {
    const auth = request.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ') || auth.length > 16384) throw new BillingError('sign_in_required', 401)
    const { data, error } = await db.auth.getUser(auth.slice(7))
    if (error || !data.user) throw new BillingError('sign_in_required', 401)
    if (env === 'sandbox' && !config.allowedUserIds.includes(data.user.id)) throw new BillingError('sandbox_tester_required', 403)
    return data.user.id
  }
  async function applyEvent(eventId: string, type: string, occurredAt: string, hash: string, subscription: SubscriptionSnapshot | null, payment: PaymentSnapshot | null, originTransaction: string | null = null) {
    return rpc('apply_event', { env, event_input: eventId, event_type_input: type, occurred_input: occurredAt, hash_input: hash, subscription_input: subscription, payment_input: payment, origin_transaction_input: originTransaction })
  }
  async function checkout(input: JsonObject, userId: string) {
    if (input.plan !== 'monthly' && input.plan !== 'annual') throw new BillingError('invalid_plan')
    const plan: Plan = input.plan, requestId = uuid(input.requestId)
    // Extra fields (price, customer, amount, custom_data, URLs) are deliberately
    // rejected instead of being forwarded into the provider API.
    if (Object.keys(input).some(key => !['action', 'plan', 'requestId'].includes(key))) throw new BillingError('invalid_checkout_request')
    const reserved = object(await rpc('reserve_checkout', { actor: userId, plan_input: plan, request_key: requestId, env }))
    if (reserved.state === 'completed') throw new BillingError('subscription_exists', 409)
    if (reserved.state === 'failed') throw new BillingError('checkout_failed_retry_new_request', 409)
    let transactionId: string
    if (reserved.created === true) {
      try {
        const customer = checked(await table('customers').select('customer_id').eq('environment', env).eq('user_id', userId).maybeSingle())
        const transaction = await provider.createTransaction(prices[plan].id, customer?.customer_id ?? null, `${config.webOrigin}/billing${env === 'sandbox' ? '/sandbox' : ''}`)
        transactionId = identifier(transaction.id, 'txn')
        if (planFromItems(transaction.items, prices) !== plan || transaction.currency_code !== 'KRW' || transaction.collection_mode !== 'automatic' || !['draft', 'ready'].includes(String(transaction.status)) || transaction.discount_id != null || (transaction.customer_id ?? null) !== (customer?.customer_id ?? null)) throw new BillingError('checkout_binding_mismatch', 409)
        await rpc('bind_checkout', { checkout_input: reserved.id, transaction_input: transactionId, env })
      } catch (error) {
        // An ambiguous provider timeout never returns a transaction to a client.
        // Fail this attempt closed; a fresh requestId may start a new attempt.
        await table('checkouts').update({ state: 'failed' }).eq('environment', env).eq('id', reserved.id).eq('state', 'creating')
        throw error
      }
    } else {
      if (reserved.state !== 'ready' || !reserved.transaction_id) throw new BillingError('checkout_creation_pending', 409)
      transactionId = identifier(reserved.transaction_id, 'txn')
      const transaction = await provider.transaction(transactionId)
      if (transaction.status === 'completed') throw new BillingError('payment_processing', 409)
      if (transaction.id !== transactionId || transaction.currency_code !== 'KRW' || transaction.collection_mode !== 'automatic' || transaction.discount_id != null
        || !['draft', 'ready', 'past_due'].includes(String(transaction.status)) || planFromItems(transaction.items, prices) !== plan) throw new BillingError('checkout_not_ready', 409)
    }
    return { environment: env, transactionId, clientToken: config.clientToken }
  }
  async function cancel(userId: string) {
    const rows = checked(await table('subscriptions').select('subscription_id,customer_id,price_id,status').eq('environment', env).eq('user_id', userId).in('status', ['active', 'past_due']).order('created_at', { ascending: false }).limit(1))
    const stored = rows?.[0]
    if (!stored) throw new BillingError('subscription_not_found', 404)
    let snapshot = subscriptionSnapshot(await provider.subscription(stored.subscription_id), prices)
    if (snapshot.id !== stored.subscription_id || snapshot.customer_id !== stored.customer_id || snapshot.price_id !== stored.price_id) throw new BillingError('subscription_mismatch', 409)
    if (snapshot.status === 'active' || snapshot.status === 'past_due') {
      if (snapshot.scheduled_action !== 'cancel') snapshot = subscriptionSnapshot(await provider.cancel(stored.subscription_id), prices)
      if (snapshot.scheduled_action !== 'cancel' || snapshot.id !== stored.subscription_id || snapshot.customer_id !== stored.customer_id || snapshot.price_id !== stored.price_id) throw new BillingError('subscription_mismatch', 409)
    }
    const now = clock().toISOString(), serialized = new TextEncoder().encode(JSON.stringify(snapshot))
    // Authenticated provider mutation responses use the same monotonic SQL
    // transition as webhooks, with a separate server-generated receipt namespace.
    await applyEvent(`api_cancel_${crypto.randomUUID()}`, 'api.cancel', now, await sha256(serialized), snapshot, null)
    return status(userId)
  }
  async function portal(userId: string) {
    const customer = checked(await table('customers').select('customer_id').eq('environment', env).eq('user_id', userId).maybeSingle())
    if (!customer) throw new BillingError('customer_not_found', 404)
    const customerId = identifier(customer.customer_id, 'ctm'), session = await provider.portal(customerId)
    const url = object(object(session.urls).general).overview
    const expectedHost = env === 'live' ? 'customer-portal.paddle.com' : 'sandbox-customer-portal.paddle.com'
    if (session.customer_id !== customerId || typeof url !== 'string') throw new BillingError('invalid_provider_data', 502)
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost || parsed.port || parsed.username || parsed.password) throw new BillingError('invalid_provider_data', 502)
    return { url }
  }
  async function discard(userId: string) {
    const rows = checked(await table('checkouts').select('id,transaction_id,state,price_id').eq('environment', env).eq('user_id', userId).in('state', ['creating', 'ready']).limit(1))
    const stored = rows?.[0]
    if (!stored) return { discarded: true }
    if (!stored.transaction_id) throw new BillingError('checkout_creation_pending', 409)
    let transaction = await provider.transaction(identifier(stored.transaction_id, 'txn'))
    if (transaction.id !== stored.transaction_id || prices[planFromItems(transaction.items, prices)].id !== stored.price_id) throw new BillingError('checkout_binding_mismatch', 409)
    if (['paid', 'completed', 'billed', 'past_due'].includes(String(transaction.status))) throw new BillingError('payment_processing', 409)
    if (['draft', 'ready'].includes(String(transaction.status))) transaction = await provider.discardTransaction(stored.transaction_id)
    // Never free the unique checkout slot until Paddle proves the old link can
    // no longer be charged. A timeout or concurrent payment remains blocked.
    if (transaction.id !== stored.transaction_id || transaction.status !== 'canceled') throw new BillingError('checkout_not_ready', 409)
    await rpc('discard_checkout', { actor: userId, checkout_input: stored.id, transaction_input: stored.transaction_id, env })
    return { discarded: true }
  }
  async function reconcileTransaction(transaction: JsonObject, expectedTransaction: string | null, expectedSubscription: string | null, expectedCustomer: string | null, expectedPrice: string) {
    if ((expectedTransaction && transaction.id !== expectedTransaction) || (expectedSubscription && transaction.subscription_id !== expectedSubscription)
      || (expectedCustomer && transaction.customer_id !== expectedCustomer) || prices[planFromItems(transaction.items, prices)].id !== expectedPrice) throw new BillingError('checkout_binding_mismatch', 409)
    if (transaction.status !== 'completed') return
    const adjustments = transaction.adjustments == null ? [] : Array.isArray(transaction.adjustments) ? transaction.adjustments.map(adjustmentSnapshot) : (() => { throw new BillingError('invalid_provider_data', 502) })()
    const payment = paidTransaction(transaction, prices, adjustments.length > 0)
    if (adjustments.some(a => a.transaction_id !== payment.id || a.customer_id !== payment.customer_id || (a.subscription_id && a.subscription_id !== payment.subscription_id))) throw new BillingError('adjustment_mismatch', 409)
    const snapshot = subscriptionSnapshot(await provider.subscription(payment.subscription_id), prices)
    if (snapshot.id !== payment.subscription_id || snapshot.customer_id !== payment.customer_id || snapshot.price_id !== payment.price_id) throw new BillingError('subscription_mismatch', 409)
    const now = clock().toISOString(), hash = await sha256(new TextEncoder().encode(JSON.stringify({ snapshot, payment, adjustments })))
    // Payments and their current adjustments commit together. A reconciled
    // refunded payment can never briefly grant access before its refund lands.
    await rpc('apply_reconciliation', { env, event_input: `api_refresh_${crypto.randomUUID()}`, occurred_input: now, hash_input: hash,
      subscription_input: snapshot, payment_input: payment, origin_transaction_input: expectedTransaction, adjustments_input: adjustments })
  }
  async function refresh(userId: string) {
    const checkouts = checked(await table('checkouts').select('transaction_id,price_id').eq('environment', env).eq('user_id', userId).in('state', ['ready']).limit(1))
    for (const stored of checkouts ?? []) {
      const transaction = await provider.transaction(identifier(stored.transaction_id, 'txn'))
      await reconcileTransaction(transaction, stored.transaction_id, null, null, stored.price_id)
    }
    const subscriptions = checked(await table('subscriptions').select('subscription_id,customer_id,price_id').eq('environment', env).eq('user_id', userId).order('created_at', { ascending: false }).limit(1))
    for (const stored of subscriptions ?? []) {
      const snapshot = subscriptionSnapshot(await provider.subscription(stored.subscription_id), prices)
      if (snapshot.id !== stored.subscription_id || snapshot.customer_id !== stored.customer_id || snapshot.price_id !== stored.price_id) throw new BillingError('subscription_mismatch', 409)
      await applyEvent(`api_refresh_${crypto.randomUUID()}`, 'api.refresh', clock().toISOString(), await sha256(new TextEncoder().encode(JSON.stringify(snapshot))), snapshot, null)
      // Bounded recovery of the two most recent completed periods; the webhook
      // ledger remains the primary source for older transaction history.
      for (const transaction of await provider.subscriptionTransactions(stored.subscription_id)) {
        await reconcileTransaction(transaction, null, stored.subscription_id, stored.customer_id, stored.price_id)
      }
    }
    return status(userId)
  }
  async function webhook(request: Request) {
    const raw = await boundedBody(request, 262144)
    await verifySignature(raw, request.headers.get('paddle-signature'), config.webhookSecret, clock().getTime())
    let event: JsonObject
    try { event = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))) } catch { throw new BillingError('invalid_event', 400) }
    const eventId = webhookEventIdentifier(event.event_id, env === 'sandbox'), type = String(event.event_type), occurredAt = timestamp(event.occurred_at)
    if (!subscriptionEvents.has(type) && !['transaction.completed', 'adjustment.created', 'adjustment.updated'].includes(type)) return { received: true, ignored: true }
    const hash = await eventDigest(event), data = object(event.data)
    // Database-only processing keeps acknowledgement within Paddle's 5 seconds.
    // No customer/email/custom_data matching or network reads occur here.
    if (type === 'transaction.completed') {
      const payment = paidTransaction(data, prices)
      await applyEvent(eventId, type, occurredAt, hash, null, payment)
    } else if (type.startsWith('adjustment.')) {
      await rpc('apply_adjustment', { env, event_input: eventId, event_type_input: type, occurred_input: occurredAt, hash_input: hash, adjustment_input: adjustmentSnapshot(data) })
    } else {
      const snapshot = subscriptionSnapshot(data, prices)
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
        return respond({ environment: env, enabled, ...(env === 'live' ? { accessMode: config.publicCheckout === true ? 'public' : 'restricted' } : {}), supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey, clientToken: enabled ? config.clientToken : '' })
      }
      if (request.method !== 'POST') throw new BillingError('method_not_allowed', 405)
      if (!credentialsConfigured(config)) throw new BillingError('billing_not_configured', 503)
      if (route === 'webhook') return respond(await webhook(request))
      const userId = await actor(request)
      let input: JsonObject
      try { input = object(JSON.parse(new TextDecoder().decode(await boundedBody(request, 4096)))) } catch (error) {
        if (error instanceof BillingError && error.code === 'body_too_large') throw error
        throw new BillingError('invalid_request')
      }
      if (input.action !== 'checkout' && Object.keys(input).some(key => key !== 'action')) throw new BillingError('invalid_request')
      if (input.action === 'checkout' && !configured(config)) throw new BillingError('billing_not_configured', 503)
      if (input.action === 'checkout' && !mayCheckout(userId)) throw new BillingError('live_checkout_access_required', 403)
      if (input.action === 'portal') return respond(await portal(userId))
      if (input.action === 'discard_checkout') return respond(await discard(userId))
      if (input.action === 'refresh') return respond(await refresh(userId))
      if (input.action === 'status') return respond(await status(userId))
      if (input.action === 'checkout') return respond(await checkout(input, userId))
      if (input.action === 'cancel') return respond(await cancel(userId))
      throw new BillingError('unknown_action')
    } catch (error) {
      return respond({ error: error instanceof BillingError ? error.code : 'billing_unavailable' }, error instanceof BillingError ? error.status : 503)
    }
  }
}
