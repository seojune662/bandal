import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PaymentSnapshot, SubscriptionSnapshot } from '../../../supabase/functions/_shared/paddle-billing/policy'

const workdir = process.env.BANDAL_PADDLE_BILLING_TEST_DIR
const environment = 'sandbox'
const monthlyPrice = 'pri_01m4tkfz9fnqcsq4ah67e092j8'
const annualPrice = 'pri_01m4tkhwzp9bhpq2yt03em2c7g'
const identifier = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 26)}`
const at = (offset: number) => new Date(Date.now() + offset).toISOString()
const day = 86_400_000

describe.skipIf(!workdir)('Paddle Sandbox actual Auth/Postgres boundaries and event transactions', () => {
  let admin: SupabaseClient, anon: SupabaseClient, apiUrl: string, publicKey: string

  async function user() {
    const email = `paddle-${crypto.randomUUID()}@example.test`, password = `Bd-${crypto.randomUUID()}!`
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (result.error || !result.data.user) throw new Error('Local test user creation failed')
    const client = createClient(apiUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signed = await client.auth.signInWithPassword({ email, password })
    if (signed.error || !signed.data.session) throw new Error('Local test user sign-in failed')
    return { id: result.data.user.id, client }
  }

  async function reserve(actor: string, request = crypto.randomUUID(), plan = 'monthly') {
    return admin.rpc('paddle_billing_reserve_checkout', { actor, request_key: request, plan_input: plan, env: environment })
  }

  async function fixture() {
    const owner = await user(), transaction = identifier('txn'), customer = identifier('ctm'), subscription = identifier('sub')
    const checkout = await reserve(owner.id)
    expect(checkout.error).toBeNull()
    const bound = await admin.rpc('paddle_billing_bind_checkout', { checkout_input: checkout.data.id, transaction_input: transaction, env: environment })
    expect(bound.error).toBeNull()
    const snapshot: SubscriptionSnapshot = {
      id: subscription, customer_id: customer, price_id: monthlyPrice, plan: 'monthly', status: 'active',
      updated_at: at(-1000), period_starts_at: at(-day), period_ends_at: at(29 * day),
      scheduled_action: null, scheduled_at: null
    }
    const payment: PaymentSnapshot = {
      id: transaction, subscription_id: subscription, customer_id: customer, price_id: monthlyPrice,
      amount: 4900, currency: 'KRW', period_starts_at: snapshot.period_starts_at!, period_ends_at: snapshot.period_ends_at!
    }
    return { owner, checkout: checkout.data, transaction, customer, subscription, snapshot, payment }
  }

  function event(input: { snapshot?: SubscriptionSnapshot | null; payment?: PaymentSnapshot | null; origin?: string | null; id?: string; hash?: string; occurred?: string } = {}) {
    return {
      env: environment, event_input: input.id ?? identifier('evt'), event_type_input: input.payment ? 'transaction.completed' : 'subscription.updated',
      occurred_input: input.occurred ?? at(0), hash_input: input.hash ?? 'a'.repeat(64),
      subscription_input: input.snapshot ?? null, payment_input: input.payment ?? null, origin_transaction_input: input.origin ?? null
    }
  }

  const apply = (input: ReturnType<typeof event>) => admin.rpc('paddle_billing_apply_event', input)
  async function status(actor: string, env = environment) {
    const result = await admin.rpc('paddle_billing_status', { actor, env })
    expect(result.error).toBeNull()
    return result.data
  }
  async function rows(table: string, field: string, value: string) {
    const result = await admin.from(`paddle_billing_${table}`).select('*').eq(field, value)
    expect(result.error).toBeNull()
    return result.data!
  }

  beforeAll(() => {
    if (!workdir || !basename(workdir).startsWith('bandal-paddle-billing-check-')) throw new Error('An isolated local Paddle test project is required')
    let runtime: Record<string, string>
    try {
      runtime = JSON.parse(execFileSync(process.env.BANDAL_SUPABASE_CLI || 'supabase', ['status', '--workdir', workdir, '--output', 'json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
      }))
    } catch { throw new Error('Could not read isolated local Supabase runtime (credential output withheld)') }
    // Refuse production or any other local project's credentials even if the
    // CLI/workdir was accidentally pointed somewhere else.
    if (runtime.API_URL !== 'http://127.0.0.1:56721') throw new Error('Paddle integration tests only use their dedicated loopback endpoint')
    apiUrl = runtime.API_URL
    publicKey = runtime.ANON_KEY!
    admin = createClient(apiUrl, runtime.SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
    anon = createClient(apiUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
  })

  it('denies direct billing reads, writes, and privileged RPCs to anonymous and signed-in users', async () => {
    const owner = await fixture(), outsider = await user()
    for (const client of [anon, owner.owner.client, outsider.client]) {
      for (const table of ['catalog', 'checkouts', 'customers', 'subscriptions', 'payments', 'events']) {
        expect((await client.from(`paddle_billing_${table}`).select('*')).error).toBeTruthy()
      }
      expect((await client.from('paddle_billing_checkouts').update({ user_id: outsider.id }).eq('id', owner.checkout.id)).error).toBeTruthy()
      expect((await client.rpc('paddle_billing_status', { actor: owner.owner.id, env: environment })).error).toBeTruthy()
      expect((await client.rpc('paddle_billing_reserve_checkout', { actor: owner.owner.id, request_key: crypto.randomUUID(), plan_input: 'monthly', env: environment })).error).toBeTruthy()
      expect((await client.rpc('paddle_billing_bind_checkout', { checkout_input: owner.checkout.id, transaction_input: identifier('txn'), env: environment })).error).toBeTruthy()
      expect((await client.rpc('paddle_billing_apply_event', event({ snapshot: owner.snapshot, payment: owner.payment }))).error).toBeTruthy()
    }
    expect(await rows('checkouts', 'id', owner.checkout.id)).toMatchObject([{ user_id: owner.owner.id, transaction_id: owner.transaction }])
    expect(await rows('subscriptions', 'subscription_id', owner.subscription)).toHaveLength(0)
  })

  it('reserves one checkout atomically across retries and separate tabs, with immutable plan and transaction', async () => {
    const owner = await user(), request = crypto.randomUUID()
    const attempts = await Promise.all(Array.from({ length: 8 }, () => reserve(owner.id, request)))
    for (const attempt of attempts) expect(attempt.error).toBeNull()
    expect(new Set(attempts.map(attempt => attempt.data.id)).size).toBe(1)
    expect(attempts.filter(attempt => attempt.data.created)).toHaveLength(1)
    const id = attempts[0]!.data.id
    const secondTab = await reserve(owner.id)
    expect(secondTab.data).toMatchObject({ id, created: false })
    expect((await reserve(owner.id, request, 'annual')).error?.message).toContain('request_id_reused')
    expect((await reserve(owner.id, crypto.randomUUID(), 'annual')).error?.message).toContain('checkout_plan_already_pending')
    const transaction = identifier('txn')
    expect((await admin.rpc('paddle_billing_bind_checkout', { checkout_input: id, transaction_input: transaction, env: environment })).error).toBeNull()
    expect((await admin.rpc('paddle_billing_bind_checkout', { checkout_input: id, transaction_input: identifier('txn'), env: environment })).error?.message).toContain('checkout_binding_mismatch')
    expect(await rows('checkouts', 'id', id)).toMatchObject([{ user_id: owner.id, price_id: monthlyPrice, transaction_id: transaction }])
  })

  it('commits one payment and receipt for concurrent duplicate deliveries and rejects changed payloads', async () => {
    const f = await fixture(), delivery = event({ snapshot: f.snapshot, payment: f.payment })
    const results = await Promise.all(Array.from({ length: 8 }, () => apply(delivery)))
    for (const result of results) expect(result.error).toBeNull()
    expect(results.filter(result => result.data === 'applied')).toHaveLength(1)
    expect(results.filter(result => result.data === 'duplicate')).toHaveLength(7)
    expect(await rows('events', 'event_id', delivery.event_input)).toHaveLength(1)
    expect(await rows('payments', 'transaction_id', f.transaction)).toHaveLength(1)
    expect(await status(f.owner.id)).toMatchObject({ active: true, status: 'active', storageBytes: 5368709120 })
    expect((await apply({ ...delivery, hash_input: 'b'.repeat(64) })).error?.message).toContain('event_payload_mismatch')
    expect(await rows('events', 'event_id', delivery.event_input)).toHaveLength(1)
    expect(await rows('payments', 'transaction_id', f.transaction)).toHaveLength(1)
  })

  it('accepts paid-before-created and created-before-paid orders without premature access', async () => {
    const paidFirst = await fixture()
    expect((await apply(event({ payment: paidFirst.payment }))).error).toBeNull()
    expect(await status(paidFirst.owner.id)).toMatchObject({ active: false, status: 'pending', storageBytes: 0 })
    expect((await apply(event({ snapshot: paidFirst.snapshot }))).error).toBeNull()
    expect(await status(paidFirst.owner.id)).toMatchObject({ active: true })

    const createdFirst = await fixture()
    expect((await apply(event({ snapshot: createdFirst.snapshot, origin: createdFirst.transaction }))).error).toBeNull()
    expect(await status(createdFirst.owner.id)).toMatchObject({ active: false, status: 'active', storageBytes: 0 })
    expect((await apply(event({ payment: createdFirst.payment }))).error).toBeNull()
    expect(await status(createdFirst.owner.id)).toMatchObject({ active: true })
    expect((await reserve(createdFirst.owner.id)).error?.message).toContain('subscription_exists')
  })

  it('leaves unbound events retryable and rolls back every write when payment validation fails', async () => {
    const f = await fixture(), early = event({ snapshot: f.snapshot })
    expect((await apply(early)).error?.message).toContain('checkout_binding_pending')
    expect(await rows('events', 'event_id', early.event_input)).toHaveLength(0)
    const invalid = event({ snapshot: f.snapshot, payment: { ...f.payment, amount: 1 } })
    expect((await apply(invalid)).error?.message).toContain('payment_mismatch')
    expect(await rows('events', 'event_id', invalid.event_input)).toHaveLength(0)
    expect(await rows('customers', 'customer_id', f.customer)).toHaveLength(0)
    expect(await rows('subscriptions', 'subscription_id', f.subscription)).toHaveLength(0)
    expect(await rows('payments', 'transaction_id', f.transaction)).toHaveLength(0)
    expect(await rows('checkouts', 'id', f.checkout.id)).toMatchObject([{ state: 'ready' }])
    expect((await apply(event({ payment: f.payment }))).error).toBeNull()
    expect((await apply(early)).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: true })
  })

  it('rejects account, customer, price, and paid-period rebinding without altering existing ownership', async () => {
    const first = await fixture(), other = await fixture()
    expect((await apply(event({ snapshot: first.snapshot, payment: first.payment }))).error).toBeNull()
    const claims = [
      event({ snapshot: first.snapshot, origin: other.transaction }),
      event({ snapshot: { ...first.snapshot, customer_id: other.customer } }),
      event({ snapshot: { ...first.snapshot, price_id: annualPrice, plan: 'annual' } }),
      event({ snapshot: { ...other.snapshot, customer_id: first.customer }, origin: other.transaction }),
      event({ payment: { ...first.payment, period_ends_at: at(30 * day) } })
    ]
    for (const claim of claims) {
      expect((await apply(claim)).error).toBeTruthy()
      expect(await rows('events', 'event_id', claim.event_input)).toHaveLength(0)
    }
    expect(await rows('subscriptions', 'subscription_id', first.subscription)).toMatchObject([{ user_id: first.owner.id, customer_id: first.customer, price_id: monthlyPrice }])
    expect(await rows('payments', 'transaction_id', first.transaction)).toHaveLength(1)
    expect(await status(other.owner.id)).toMatchObject({ active: false, status: 'none' })
  })

  it('orders subscription updates by provider time and does not resurrect canceled access', async () => {
    const f = await fixture()
    expect((await apply(event({ snapshot: f.snapshot, payment: f.payment }))).error).toBeNull()
    const pastDue = { ...f.snapshot, status: 'past_due', updated_at: at(1000) }
    expect((await apply(event({ snapshot: pastDue, occurred: at(1000) }))).error).toBeNull()
    expect((await apply(event({ snapshot: f.snapshot, occurred: at(2000) }))).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: false, status: 'past_due' })
    const canceled = { ...f.snapshot, status: 'canceled', updated_at: at(3000) }
    expect((await apply(event({ snapshot: canceled, occurred: at(3000) }))).error).toBeNull()
    expect((await apply(event({ snapshot: { ...f.snapshot, updated_at: at(4000) }, occurred: at(4000) }))).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: false, status: 'canceled', storageBytes: 0 })
  })

  it('extends an expired subscription only when a new paid renewal covers the current time', async () => {
    const f = await fixture(), oldPeriod = { period_starts_at: at(-31 * day), period_ends_at: at(-day) }
    expect((await apply(event({ snapshot: { ...f.snapshot, ...oldPeriod }, payment: { ...f.payment, ...oldPeriod } }))).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: false })
    const future = { ...f.payment, id: identifier('txn'), period_starts_at: at(day), period_ends_at: at(31 * day) }
    expect((await apply(event({ payment: future }))).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: false })
    const renewed = { ...f.payment, id: identifier('txn'), period_starts_at: at(-day), period_ends_at: at(29 * day) }
    const delivery = event({ payment: renewed })
    expect((await apply(delivery)).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: true, storageBytes: 5368709120 })
    expect((await apply({ ...delivery, event_input: identifier('evt') })).error).toBeNull()
    expect(await rows('payments', 'transaction_id', renewed.id)).toHaveLength(1)
    expect(await rows('payments', 'subscription_id', f.subscription)).toHaveLength(3)
  })

  it('bounds access by paid periods and effective cancellation, with no Live entitlement', async () => {
    const f = await fixture()
    expect((await apply(event({ snapshot: { ...f.snapshot, scheduled_action: 'cancel', scheduled_at: f.payment.period_ends_at }, payment: f.payment }))).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: true, cancelAtPeriodEnd: true })
    expect(await status(f.owner.id, 'live')).toMatchObject({ active: false, status: 'none', storageBytes: 0 })
    expect((await admin.rpc('paddle_billing_reserve_checkout', { actor: f.owner.id, plan_input: 'monthly', request_key: crypto.randomUUID(), env: 'live' })).error).toBeTruthy()
    expect((await apply({ ...event({ snapshot: f.snapshot }), env: 'live' })).error).toBeTruthy()
    const effectiveCancel = { ...f.snapshot, updated_at: at(1000), scheduled_action: 'cancel', scheduled_at: at(-500) }
    expect((await apply(event({ snapshot: effectiveCancel }))).error).toBeNull()
    expect(await status(f.owner.id)).toMatchObject({ active: false, storageBytes: 0 })
    const expired = await fixture()
    const period = { period_starts_at: at(-31 * day), period_ends_at: at(-day) }
    expect((await apply(event({ snapshot: { ...expired.snapshot, ...period }, payment: { ...expired.payment, ...period } }))).error).toBeNull()
    expect(await status(expired.owner.id)).toMatchObject({ active: false, status: 'active', storageBytes: 0 })
  })
})
