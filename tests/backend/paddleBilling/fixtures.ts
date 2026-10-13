import { SANDBOX_PRICES, type Plan } from '../../../supabase/functions/_shared/paddle-billing/policy'

export const TEST_USER = '11111111-1111-4111-8111-111111111111'
export const TEST_IDS = { transaction: `txn_${'a'.repeat(26)}`, subscription: `sub_${'b'.repeat(26)}`, customer: `ctm_${'c'.repeat(26)}`, event: `evt_${'d'.repeat(26)}` }
export const TEST_NOW = new Date('2026-10-13T00:00:00.000Z')
export const TEST_SECRET = 'pdl_ntfset_unit_test_not_a_real_secret'
export function priceItem(plan: Plan = 'monthly') {
  const price = SANDBOX_PRICES[plan]
  return { quantity: 1, price: { id: price.id, unit_price: { currency_code: 'KRW', amount: String(price.amount) }, billing_cycle: { interval: price.interval, frequency: 1 }, tax_mode: 'internal', trial_period: null } }
}
export function transactionFixture(plan: Plan = 'monthly') {
  const amount = String(SANDBOX_PRICES[plan].amount)
  return {
    id: TEST_IDS.transaction, customer_id: TEST_IDS.customer, subscription_id: TEST_IDS.subscription,
    status: 'completed', currency_code: 'KRW', collection_mode: 'automatic', items: [priceItem(plan)], discount_id: null,
    billing_period: { starts_at: '2026-10-12T00:00:00Z', ends_at: plan === 'monthly' ? '2026-11-12T00:00:00Z' : '2027-10-12T00:00:00Z' },
    details: { totals: { total: amount, grand_total: amount, balance: '0', credit: '0', discount: '0', currency_code: 'KRW' }, adjusted_totals: { grand_total: amount } },
    payments: [{ status: 'captured', amount }]
  }
}
export function subscriptionFixture(plan: Plan = 'monthly') {
  return {
    id: TEST_IDS.subscription, customer_id: TEST_IDS.customer, transaction_id: TEST_IDS.transaction,
    status: 'active', currency_code: 'KRW', collection_mode: 'automatic', items: [priceItem(plan)],
    updated_at: TEST_NOW.toISOString(), current_billing_period: transactionFixture(plan).billing_period,
    scheduled_change: null as { action: string; effective_at: string } | null
  }
}
export async function signature(body: Uint8Array | string, now = TEST_NOW, secret = TEST_SECRET) {
  const stamp = Math.floor(now.getTime() / 1000), encoder = new TextEncoder(), bytes = typeof body === 'string' ? encoder.encode(body) : body
  const prefix = encoder.encode(`${stamp}:`), payload = new Uint8Array(prefix.length + bytes.length)
  payload.set(prefix); payload.set(bytes, prefix.length)
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const result = await crypto.subtle.sign('HMAC', key, payload)
  return `ts=${stamp};h1=${Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
