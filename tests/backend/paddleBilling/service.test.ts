import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBillingService, configured, type BillingConfig } from '../../../supabase/functions/_shared/paddle-billing/service'
import { createPaddleProvider, type PaddleProvider } from '../../../supabase/functions/_shared/paddle-billing/provider'
import { TEST_IDS, TEST_NOW, TEST_SECRET, TEST_USER, signature, subscriptionFixture, transactionFixture } from './fixtures'

const config: BillingConfig = { enabled: true, environment: 'sandbox', webOrigin: 'https://bandal.io', supabaseUrl: 'https://fixture.supabase.co', supabaseAnonKey: 'public-fixture', apiKey: 'pdl_sdbx_apikey_unit_test_not_real', clientToken: 'test_unittest', webhookSecret: TEST_SECRET, allowedUserIds: [TEST_USER] }
function fixture(overrides: Partial<BillingConfig> = {}) {
  const getUser = vi.fn(async () => ({ data: { user: { id: TEST_USER } }, error: null }))
  const rpc = vi.fn(async (name: string, _input: unknown): Promise<any> => {
    if (name.endsWith('reserve_checkout')) return { data: { id: TEST_USER, created: true, state: 'creating' }, error: null }
    if (name.endsWith('status')) return { data: { active: false, status: 'none' }, error: null }
    return { data: 'applied', error: null }
  })
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), update: vi.fn(() => query), in: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(async () => ({ data: [], error: null })), maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
  const db = { auth: { getUser }, rpc, from: vi.fn(() => query) } as unknown as SupabaseClient
  const draft = { ...transactionFixture(), status: 'draft', customer_id: null, subscription_id: null }
  const provider: PaddleProvider = { createTransaction: vi.fn(async () => draft), transaction: vi.fn(async () => draft), subscription: vi.fn(async () => subscriptionFixture()), cancel: vi.fn(async () => subscriptionFixture()) }
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
