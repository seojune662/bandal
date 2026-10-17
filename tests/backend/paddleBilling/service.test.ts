import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBillingService, configured, type BillingConfig } from '../../../supabase/functions/_shared/paddle-billing/service'
import { createPaddleProvider, type PaddleProvider } from '../../../supabase/functions/_shared/paddle-billing/provider'
import { SANDBOX_PRICES, type PriceCatalog } from '../../../supabase/functions/_shared/paddle-billing/policy'
import { TEST_IDS, TEST_NOW, TEST_SECRET, TEST_USER, signature, subscriptionFixture, transactionFixture } from './fixtures'

const config: BillingConfig = { enabled: true, environment: 'sandbox', webOrigin: 'https://bandal.io', supabaseUrl: 'https://fixture.supabase.co', supabaseAnonKey: 'public-fixture', apiKey: 'pdl_sdbx_apikey_unit_test_not_real', clientToken: 'test_unittest', webhookSecret: TEST_SECRET, allowedUserIds: [TEST_USER] }
function fixture(overrides: Partial<BillingConfig> = {}) {
  const getUser = vi.fn(async () => ({ data: { user: { id: TEST_USER } }, error: null }))
  const rpc = vi.fn(async (name: string, _input: unknown): Promise<any> => {
    if (name === 'bandal_subscription_status_for') return { data: { active: false, sources: [], duplicateSubscription: false }, error: null }
    if (name === 'bandal_sync_status_for') return { data: { storageUsedBytes: 120, storageLimitBytes: 5368709120, usageComplete: true, writeAllowed: true, accessSource: 'subscription' }, error: null }
    if (name.endsWith('reserve_checkout')) return { data: { id: TEST_USER, created: true, state: 'creating' }, error: null }
    if (name.endsWith('status')) return { data: { active: false, status: 'none' }, error: null }
    return { data: 'applied', error: null }
  })
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), update: vi.fn(() => query), in: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(async () => ({ data: [], error: null })), maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
  const db = { auth: { getUser }, rpc, from: vi.fn(() => query) } as unknown as SupabaseClient
  const draft = { ...transactionFixture(), status: 'draft', customer_id: null, subscription_id: null }
  const provider: PaddleProvider = { createTransaction: vi.fn(async () => draft), transaction: vi.fn(async () => draft), subscription: vi.fn(async () => subscriptionFixture()), cancel: vi.fn(async () => subscriptionFixture()), discardTransaction: vi.fn(async () => ({ ...draft, status: 'canceled' })), portal: vi.fn(async () => ({ customer_id: TEST_IDS.customer, urls: { general: { overview: 'https://sandbox-customer-portal.paddle.com/fixture?token=fixture' } } })), subscriptionTransactions: vi.fn(async () => []) }
  return { handle: createBillingService(db, { ...config, ...overrides }, provider, () => TEST_NOW), provider, rpc, getUser, query }
}
function request(input: unknown, token = 'user-token', origin = config.webOrigin) {
  return new Request('https://fixture.supabase.co/functions/v1/paddle-billing', { method: 'POST', headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' }, body: JSON.stringify(input) })
}
async function webhook(type: string, data: unknown, secret = TEST_SECRET, eventId = TEST_IDS.event) {
  const body = JSON.stringify({ event_id: eventId, event_type: type, occurred_at: TEST_NOW.toISOString(), data })
  return new Request('https://fixture.supabase.co/functions/v1/paddle-webhook', { method: 'POST', headers: { 'paddle-signature': await signature(body, TEST_NOW, secret) }, body })
}
describe('Sandbox billing service boundaries', () => {
  it('accepts actual base64 webhook secret characters and rejects whitespace, control bytes and wrong prefixes', () => {
    expect(configured({ ...config, webhookSecret: 'pdl_ntfset_dGVzdC+/AA==' })).toBe(true)
    for (const webhookSecret of ['pdl_ntfset_dGVzdC+/AA== ', 'pdl_ntfset_dGVzdC+/AA==\n', 'pdl_ntfset_a\rb', 'pdl_ntfset_a\u0000b', 'pdl_ntfset_a b', 'pdl_live_dGVzdC+/AA==', 'pdl_ntfset_dGVzdC=+/AA', 'pdl_ntfset_a===']) {
      expect(configured({ ...config, webhookSecret })).toBe(false)
    }
  })
  it('public configuration exposes public values only and fails closed for Live', async () => {
    const f = fixture(), response = await f.handle(new Request('https://fixture.supabase.co/functions/v1/paddle-billing?action=config'))
    const data = await response.json()
    expect(Object.keys(data).sort()).toEqual(['clientToken', 'enabled', 'environment', 'supabaseAnonKey', 'supabaseUrl'].sort())
    expect(JSON.stringify(data)).not.toContain(config.apiKey); expect(JSON.stringify(data)).not.toContain(TEST_SECRET)
    expect(configured({ ...config, environment: 'live' })).toBe(false)
    expect((await fixture({ environment: 'live' }).handle(request({ action: 'status' }))).status).toBe(503)
    expect(f.getUser).not.toHaveBeenCalled()
  })
  it('requires a real Auth user and an explicit Sandbox tester allowlist', async () => {
    const denied = fixture({ allowedUserIds: [] })
    expect((await denied.handle(request({ action: 'checkout', plan: 'monthly', requestId: crypto.randomUUID() }))).status).toBe(403)
    expect(denied.rpc).not.toHaveBeenCalled(); expect(denied.provider.createTransaction).not.toHaveBeenCalled()
    const invalid = fixture(); invalid.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as any)
    expect((await invalid.handle(request({ action: 'status' }))).status).toBe(401)
  })
  it('rejects hostile origins and forged prices, custom data, customer IDs or URLs', async () => {
    const f = fixture()
    expect((await f.handle(request({ action: 'status' }, 'token', 'https://attacker.test'))).status).toBe(403)
    for (const extra of [{ price: 1 }, { customer_id: TEST_IDS.customer }, { custom_data: { user_id: TEST_USER } }, { successUrl: 'https://attacker.test' }]) {
      expect((await f.handle(request({ action: 'checkout', plan: 'monthly', requestId: crypto.randomUUID(), ...extra }))).status).toBe(400)
    }
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('binds the server-created transaction before exposing its ID and forwards no account metadata', async () => {
    const f = fixture(), requestId = crypto.randomUUID()
    const response = await f.handle(request({ action: 'checkout', plan: 'monthly', requestId }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ environment: 'sandbox', transactionId: TEST_IDS.transaction, clientToken: config.clientToken })
    expect(f.provider.createTransaction).toHaveBeenCalledWith('pri_01m4tkfz9fnqcsq4ah67e092j8', null, 'https://bandal.io/billing/sandbox')
    expect(f.rpc).toHaveBeenLastCalledWith('paddle_billing_bind_checkout', { checkout_input: TEST_USER, transaction_input: TEST_IDS.transaction, env: 'sandbox' })
  })
  it('does not create a second provider transaction for an overlapping checkout', async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: { created: false, state: 'creating' }, error: null })
    const result = await f.handle(request({ action: 'checkout', plan: 'annual', requestId: crypto.randomUUID() }))
    expect(await result.json()).toEqual({ error: 'checkout_creation_pending' })
    expect(f.provider.createTransaction).not.toHaveBeenCalled()
  })
  it('reuses a persisted transaction without creating or changing its binding', async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: { created: false, state: 'ready', transaction_id: TEST_IDS.transaction }, error: null })
    expect((await f.handle(request({ action: 'checkout', plan: 'monthly', requestId: crypto.randomUUID() }))).status).toBe(200)
    expect(f.provider.transaction).toHaveBeenCalledWith(TEST_IDS.transaction); expect(f.provider.createTransaction).not.toHaveBeenCalled()
  })
  it('verifies signature before parsing JSON or touching persistence/provider', async () => {
    const f = fixture(), req = new Request('https://fixture.test', { method: 'POST', body: '{broken', headers: { 'paddle-signature': 'bad' } })
    expect((await f.handle(req, 'webhook')).status).toBe(401)
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.provider.transaction).not.toHaveBeenCalled()
    expect((await f.handle(await webhook('transaction.completed', transactionFixture(), `${TEST_SECRET}_wrong`), 'webhook')).status).toBe(401)
  })
  it('writes a normalized fully-paid transaction atomically without trusting custom_data', async () => {
    const f = fixture(), transaction = { ...transactionFixture(), custom_data: { user_id: 'attacker' } }
    expect((await f.handle(await webhook('transaction.completed', transaction), 'webhook')).status).toBe(200)
    const payload = f.rpc.mock.calls[0]![1] as any
    expect(payload.payment_input.amount).toBe(4900); expect(payload.subscription_input).toBeNull()
    expect(JSON.stringify(payload)).not.toContain('attacker'); expect(f.provider.transaction).not.toHaveBeenCalled()
  })
  it('subscription creation can bind only the provider origin transaction, with no paid grant', async () => {
    const f = fixture()
    expect((await f.handle(await webhook('subscription.created', subscriptionFixture()), 'webhook')).status).toBe(200)
    expect(f.rpc.mock.calls[0]![1]).toMatchObject({ origin_transaction_input: TEST_IDS.transaction, payment_input: null })
  })
  it('accepts the official Simulator event ID format but rejects its unrelated demo prices before persistence', async () => {
    const f = fixture(), source = subscriptionFixture(), item = source.items[0]!
    const demo = { ...source, items: [
      { ...item, quantity: 10, price: { ...item.price, id: 'pri_01gsz8x8sawmvhz1pv30nge1ke' } },
      { ...item, quantity: 1, price: { ...item.price, id: 'pri_01h1vjfevh5etwq3rb416a23h2' } }
    ] }
    const response = await f.handle(await webhook('subscription.created', demo, TEST_SECRET, `ntfsimevt_${'e'.repeat(26)}`), 'webhook')
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'price_mismatch' })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('requires stored checkout ownership for a valid Simulator event and rejects server-receipt namespace collisions', async () => {
    const f = fixture(), eventId = `ntfsimevt_${'e'.repeat(26)}`
    f.rpc.mockResolvedValueOnce({ data: null, error: { message: 'checkout_binding_pending' } })
    const response = await f.handle(await webhook('subscription.created', subscriptionFixture(), TEST_SECRET, eventId), 'webhook')
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'checkout_binding_pending' })
    expect(f.rpc.mock.calls[0]![1]).toMatchObject({ event_input: eventId, origin_transaction_input: TEST_IDS.transaction, payment_input: null })
    f.rpc.mockClear()
    for (const forbidden of [`api_cancel_${crypto.randomUUID()}`, `ntf_${'e'.repeat(26)}`, `ntfsimevt_${'e'.repeat(25)}`]) {
      expect((await f.handle(await webhook('subscription.created', subscriptionFixture(), TEST_SECRET, forbidden), 'webhook')).ok).toBe(false)
    }
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('keeps missing bindings and payload collisions retryable without acknowledging success', async () => {
    for (const code of ['checkout_binding_pending', 'event_payload_mismatch']) {
      const f = fixture(); f.rpc.mockResolvedValueOnce({ data: null, error: { message: code } })
      const response = await f.handle(await webhook('subscription.updated', subscriptionFixture()), 'webhook')
      expect(response.ok).toBe(false); expect(await response.json()).toEqual({ error: code })
    }
  })
  it('accepts replay with a new notification ID and reordered JSON as the same immutable event', async () => {
    const f = fixture(), receipts = new Map<string, string>()
    f.rpc.mockImplementation(async (_name, input: any) => {
      const previous = receipts.get(input.event_input)
      if (previous && previous !== input.hash_input) return { data: null, error: { message: 'event_payload_mismatch' } }
      receipts.set(input.event_input, input.hash_input)
      return { data: previous ? 'duplicate' : 'applied', error: null }
    })
    const event = { event_id: TEST_IDS.event, event_type: 'transaction.completed', occurred_at: TEST_NOW.toISOString(), notification_id: `ntf_${'1'.repeat(26)}`, data: transactionFixture() }
    const reverseKeys = (value: any): any => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseKeys(value[key])])) : value
    const replay = reverseKeys({ ...event, notification_id: `ntf_${'2'.repeat(26)}` })
    for (const body of [JSON.stringify(event), JSON.stringify(replay, null, 2)]) {
      const req = new Request('https://fixture.test', { method: 'POST', headers: { 'paddle-signature': await signature(body) }, body })
      expect((await f.handle(req, 'webhook')).status).toBe(200)
    }
    expect(receipts.size).toBe(1)
    expect((f.rpc.mock.calls[0]![1] as any).hash_input).toBe((f.rpc.mock.calls[1]![1] as any).hash_input)
    expect(f.provider.transaction).not.toHaveBeenCalled()
  })
  it('rejects changed event data under the same event ID even when a new notification is validly signed', async () => {
    const f = fixture(), receipts = new Map<string, string>()
    f.rpc.mockImplementation(async (_name, input: any) => {
      const previous = receipts.get(input.event_input)
      if (previous && previous !== input.hash_input) return { data: null, error: { message: 'event_payload_mismatch' } }
      receipts.set(input.event_input, input.hash_input)
      return { data: previous ? 'duplicate' : 'applied', error: null }
    })
    const source = subscriptionFixture()
    expect((await f.handle(await webhook('subscription.updated', source), 'webhook')).status).toBe(200)
    const body = JSON.stringify({ event_id: TEST_IDS.event, event_type: 'subscription.updated', occurred_at: TEST_NOW.toISOString(), notification_id: `ntf_${'3'.repeat(26)}`, data: { ...source, status: 'canceled' } })
    const response = await f.handle(new Request('https://fixture.test', { method: 'POST', headers: { 'paddle-signature': await signature(body) }, body }), 'webhook')
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'event_payload_mismatch' })
    expect(receipts.size).toBe(1)
    expect(receipts.get(TEST_IDS.event)).toBe((f.rpc.mock.calls[0]![1] as any).hash_input)
    expect((f.rpc.mock.calls[0]![1] as any).hash_input).not.toBe((f.rpc.mock.calls[1]![1] as any).hash_input)
  })
  it('does not grant anything from payment-failed or unsupported events', async () => {
    const f = fixture()
    expect((await f.handle(await webhook('transaction.payment_failed', transactionFixture()), 'webhook')).status).toBe(200)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('schedules cancellation server-side and applies response through monotonic persistence', async () => {
    const f = fixture(); f.query.limit.mockResolvedValueOnce({ data: [{ subscription_id: TEST_IDS.subscription, customer_id: TEST_IDS.customer, price_id: 'pri_01m4tkfz9fnqcsq4ah67e092j8', status: 'active' }], error: null })
    vi.mocked(f.provider.cancel).mockResolvedValueOnce({ ...subscriptionFixture(), scheduled_change: { action: 'cancel', effective_at: '2026-11-12T00:00:00Z' } })
    expect((await f.handle(request({ action: 'cancel' }))).status).toBe(200)
    expect(f.provider.cancel).toHaveBeenCalledWith(TEST_IDS.subscription)
    expect(f.rpc.mock.calls[0]![1]).toMatchObject({ event_type_input: 'api.cancel', subscription_input: { status: 'active', scheduled_action: 'cancel' }, payment_input: null })
  })
  it('returns only safe provider failures, never credentials from thrown transport errors', async () => {
    const provider = createPaddleProvider(config.apiKey, vi.fn(async () => { throw new Error(`Authorization: Bearer ${config.apiKey}`) }))
    await expect(provider.transaction(TEST_IDS.transaction)).rejects.toMatchObject({ code: 'provider_unavailable', message: 'provider_unavailable' })
    const calls = vi.fn(async () => Response.json({ data: transactionFixture() }))
    await createPaddleProvider(config.apiKey, calls).cancel(TEST_IDS.subscription)
    expect(calls.mock.calls[0]![0]).toBe(`https://sandbox-api.paddle.com/subscriptions/${TEST_IDS.subscription}/cancel`)
    expect(JSON.parse(String((calls.mock.calls[0]![1] as RequestInit).body))).toEqual({ effective_from: 'next_billing_period' })
  })
})

const livePrices: PriceCatalog = { monthly: { ...SANDBOX_PRICES.monthly, id: `pri_${'l'.repeat(26)}` }, annual: { ...SANDBOX_PRICES.annual, id: `pri_${'n'.repeat(26)}` } }
const liveConfig: Partial<BillingConfig> = { environment: 'live', apiKey: 'pdl_live_apikey_fixture', clientToken: 'live_fixture', prices: livePrices, allowedUserIds: [], publicCheckout: true }
function adjustmentFixture(status = 'approved') {
  return { id: `adj_${'e'.repeat(26)}`, transaction_id: TEST_IDS.transaction, subscription_id: TEST_IDS.subscription, customer_id: TEST_IDS.customer,
    action: 'refund', status, currency_code: 'KRW', totals: { total: '4900', currency_code: 'KRW' }, updated_at: TEST_NOW.toISOString() }
}
describe('Live billing ownership, management and recovery', () => {
  it('returns only the authenticated account cloud usage and never accepts an actor override', async () => {
    const f = fixture(liveConfig)
    const response = await f.handle(request({ action: 'status' }))
    expect(response.status).toBe(200)
    expect((await response.json()).sync).toMatchObject({ storageUsedBytes: 120, usageComplete: true })
    expect(f.rpc).toHaveBeenCalledWith('bandal_sync_status_for', { actor: TEST_USER })
    f.rpc.mockClear()
    expect((await f.handle(request({ action: 'status', actor: crypto.randomUUID() }))).status).toBe(400)
    expect(f.rpc).not.toHaveBeenCalled()
    const sandbox = fixture()
    expect((await (await sandbox.handle(request({ action: 'status' }))).json()).sync).toBeUndefined()
    expect(sandbox.rpc).not.toHaveBeenCalledWith('bandal_sync_status_for', expect.anything())
  })
  it('accepts only matched Live credentials/catalog and never falls back to Sandbox prices', async () => {
    const f = fixture(liveConfig)
    expect(configured({ ...config, ...liveConfig })).toBe(true)
    expect((await f.handle(request({ action: 'status' }))).status).toBe(200)
    expect(f.rpc).toHaveBeenCalledWith('paddle_billing_status', { actor: TEST_USER, env: 'live' })
    for (const mismatch of [{ prices: undefined }, { clientToken: config.clientToken }, { apiKey: config.apiKey }, { prices: SANDBOX_PRICES }]) {
      expect(configured({ ...config, ...liveConfig, ...mismatch })).toBe(false)
    }
  })
  it('defaults Live purchases to an explicit allowlist while retaining billing management', async () => {
    const restricted = fixture({ ...liveConfig, publicCheckout: false })
    expect((await restricted.handle(request({ action: 'checkout', plan: 'monthly', requestId: crypto.randomUUID() }))).status).toBe(403)
    expect(restricted.provider.createTransaction).not.toHaveBeenCalled()
    expect(await (await restricted.handle(request({ action: 'status' }))).json()).toMatchObject({ enabled: false })
    const allowed = fixture({ ...liveConfig, publicCheckout: false, checkoutAllowedUserIds: [TEST_USER] })
    expect(await (await allowed.handle(request({ action: 'status' }))).json()).toMatchObject({ enabled: true })
  })
  it('creates Live checkout with the server Live price and correct return page', async () => {
    const f = fixture(liveConfig), transaction = transactionFixture()
    transaction.items[0]!.price.id = livePrices.monthly.id as any
    vi.mocked(f.provider.createTransaction).mockResolvedValueOnce({ ...transaction, status: 'draft', customer_id: null, subscription_id: null })
    const response = await f.handle(request({ action: 'checkout', plan: 'monthly', requestId: crypto.randomUUID() }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ environment: 'live', transactionId: TEST_IDS.transaction })
    expect(f.provider.createTransaction).toHaveBeenCalledWith(livePrices.monthly.id, null, 'https://bandal.io/billing')
    expect(f.rpc.mock.calls.every(([, args]: any) => args.env === 'live')).toBe(true)
  })
  it('keeps webhook and account management working while new purchases are disabled', async () => {
    const f = fixture({ enabled: false })
    expect((await f.handle(request({ action: 'checkout', plan: 'monthly', requestId: crypto.randomUUID() }))).status).toBe(503)
    expect(f.provider.createTransaction).not.toHaveBeenCalled()
    expect(await (await f.handle(request({ action: 'status' }))).json()).toMatchObject({ enabled: false })
    expect((await f.handle(await webhook('transaction.completed', transactionFixture()), 'webhook')).status).toBe(200)
  })
  it('mints portal links from stored ownership and rejects client-supplied ownership fields', async () => {
    const f = fixture(liveConfig)
    f.query.maybeSingle.mockResolvedValue({ data: { customer_id: TEST_IDS.customer }, error: null })
    vi.mocked(f.provider.portal).mockResolvedValueOnce({ customer_id: TEST_IDS.customer, urls: { general: { overview: 'https://customer-portal.paddle.com/fixture?token=fixture' } } })
    const response = await f.handle(request({ action: 'portal' }))
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ url: 'https://customer-portal.paddle.com/fixture?token=fixture' })
    expect(f.provider.portal).toHaveBeenCalledWith(TEST_IDS.customer)
    expect(f.query.eq).toHaveBeenCalledWith('environment', 'live'); expect(f.query.eq).toHaveBeenCalledWith('user_id', TEST_USER)
    expect((await f.handle(request({ action: 'portal', customer_id: TEST_IDS.customer }))).status).toBe(400)
    expect(f.provider.portal).toHaveBeenCalledTimes(1)
  })
  it('rejects missing customers, unauthenticated portal requests and hostile provider redirect URLs', async () => {
    const missing = fixture()
    expect((await missing.handle(request({ action: 'portal' }))).status).toBe(404); expect(missing.provider.portal).not.toHaveBeenCalled()
    missing.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as any)
    expect((await missing.handle(request({ action: 'portal' }))).status).toBe(401)
    for (const url of ['https://attacker.test/', 'https://customer-portal.paddle.com.evil.test/', 'http://customer-portal.paddle.com/', 'https://user@customer-portal.paddle.com/']) {
      const f = fixture(liveConfig); f.query.maybeSingle.mockResolvedValueOnce({ data: { customer_id: TEST_IDS.customer }, error: null })
      vi.mocked(f.provider.portal).mockResolvedValueOnce({ customer_id: TEST_IDS.customer, urls: { general: { overview: url } } })
      expect((await f.handle(request({ action: 'portal' }))).status).toBe(502)
    }
  })
  it('frees a pending checkout only after Paddle confirms it is canceled', async () => {
    const f = fixture()
    f.query.limit.mockResolvedValueOnce({ data: [{ id: TEST_USER, state: 'ready', transaction_id: TEST_IDS.transaction, price_id: SANDBOX_PRICES.monthly.id }], error: null })
    expect(await (await f.handle(request({ action: 'discard_checkout' }))).json()).toEqual({ discarded: true })
    expect(f.provider.discardTransaction).toHaveBeenCalledWith(TEST_IDS.transaction)
    expect(f.rpc).toHaveBeenCalledWith('paddle_billing_discard_checkout', { actor: TEST_USER, checkout_input: TEST_USER, transaction_input: TEST_IDS.transaction, env: 'sandbox' })
  })
  it('does not free a checkout on provider timeout, paid state or mismatched cancellation response', async () => {
    for (const kind of ['timeout', 'paid', 'mismatch']) {
      const f = fixture()
      f.query.limit.mockResolvedValueOnce({ data: [{ id: TEST_USER, state: 'ready', transaction_id: TEST_IDS.transaction, price_id: SANDBOX_PRICES.monthly.id }], error: null })
      if (kind === 'timeout') vi.mocked(f.provider.discardTransaction).mockRejectedValueOnce(new Error('provider failure'))
      if (kind === 'paid') vi.mocked(f.provider.transaction).mockResolvedValueOnce(transactionFixture())
      if (kind === 'mismatch') vi.mocked(f.provider.discardTransaction).mockResolvedValueOnce({ id: `txn_${'z'.repeat(26)}`, status: 'canceled' })
      expect((await f.handle(request({ action: 'discard_checkout' }))).ok).toBe(false)
      expect(f.rpc).not.toHaveBeenCalled()
    }
  })
  it('rejects Live simulator events and Sandbox catalog evidence even under a valid destination signature', async () => {
    const f = fixture(liveConfig)
    expect((await f.handle(await webhook('subscription.created', subscriptionFixture(), TEST_SECRET, `ntfsimevt_${'e'.repeat(26)}`), 'webhook')).ok).toBe(false)
    expect((await f.handle(await webhook('transaction.completed', transactionFixture()), 'webhook')).status).toBe(409)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('normalizes signed adjustment events without trusting extra ownership metadata', async () => {
    const f = fixture(), adjustment = { ...adjustmentFixture(), custom_data: { user_id: 'attacker' } }
    expect((await f.handle(await webhook('adjustment.updated', adjustment), 'webhook')).status).toBe(200)
    expect(f.rpc).toHaveBeenCalledWith('paddle_billing_apply_adjustment', expect.objectContaining({ env: 'sandbox', adjustment_input: expect.objectContaining({ id: adjustment.id, amount: 4900, status: 'approved' }) }))
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain('attacker')
    const missing = fixture(); missing.rpc.mockResolvedValueOnce({ data: null, error: { message: 'adjustment_binding_pending' } })
    expect((await missing.handle(await webhook('adjustment.created', adjustment), 'webhook')).status).toBe(503)
  })
  it('recovers an owned completed checkout and refund atomically, without client IDs', async () => {
    const f = fixture(), transaction = { ...transactionFixture(), adjustments: [adjustmentFixture()] }
    transaction.details.adjusted_totals.grand_total = '0'
    f.query.limit.mockResolvedValueOnce({ data: [{ transaction_id: TEST_IDS.transaction, price_id: SANDBOX_PRICES.monthly.id }], error: null })
    vi.mocked(f.provider.transaction).mockResolvedValueOnce(transaction)
    expect((await f.handle(request({ action: 'refresh' }))).status).toBe(200)
    expect(f.rpc).toHaveBeenCalledWith('paddle_billing_apply_reconciliation', expect.objectContaining({ origin_transaction_input: TEST_IDS.transaction, payment_input: expect.objectContaining({ amount: 4900 }), adjustments_input: [expect.objectContaining({ action: 'refund', amount: 4900 })] }))
    expect(f.rpc).not.toHaveBeenCalledWith('paddle_billing_apply_event', expect.anything())
    expect((await f.handle(request({ action: 'refresh', transaction_id: TEST_IDS.transaction }))).status).toBe(400)
  })
  it('refuses reconciliation when provider returns another transaction or an unexplained adjusted total', async () => {
    for (const kind of ['wrong_id', 'missing_adjustments']) {
      const f = fixture(), transaction = transactionFixture()
      if (kind === 'wrong_id') transaction.id = `txn_${'z'.repeat(26)}`
      else transaction.details.adjusted_totals.grand_total = '0'
      f.query.limit.mockResolvedValueOnce({ data: [{ transaction_id: TEST_IDS.transaction, price_id: SANDBOX_PRICES.monthly.id }], error: null })
      vi.mocked(f.provider.transaction).mockResolvedValueOnce(transaction)
      expect((await f.handle(request({ action: 'refresh' }))).ok).toBe(false)
      expect(f.rpc).not.toHaveBeenCalled()
    }
  })
  it('uses Live API origin and safe PATCH cancellation semantics', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: { id: TEST_IDS.transaction, status: 'canceled' } }))
    const provider = createPaddleProvider('pdl_live_apikey_fixture', fetcher, 'live')
    await provider.discardTransaction(TEST_IDS.transaction)
    expect(fetcher.mock.calls[0]![0]).toBe(`https://api.paddle.com/transactions/${TEST_IDS.transaction}`)
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'PATCH', body: '{"status":"canceled"}' })
  })
})
