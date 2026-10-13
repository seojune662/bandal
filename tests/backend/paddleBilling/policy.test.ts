import { describe, expect, it } from 'vitest'
import { boundedBody, paidTransaction, planFromItems, subscriptionSnapshot, verifySignature } from '../../../supabase/functions/_shared/paddle-billing/policy'
import { TEST_NOW, TEST_SECRET, priceItem, signature, subscriptionFixture, transactionFixture } from './fixtures'

describe('Paddle Sandbox signature boundary', () => {
  it('verifies the exact original bytes, Korean text and rotated signature candidates', async () => {
    const raw = new TextEncoder().encode('{"text":"반달 동기화"}\n'), valid = await signature(raw)
    await expect(verifySignature(raw, valid, TEST_SECRET, TEST_NOW.getTime())).resolves.toBeUndefined()
    await expect(verifySignature(raw, `${valid};h1=${'0'.repeat(64)}`, TEST_SECRET, TEST_NOW.getTime())).resolves.toBeUndefined()
    await expect(verifySignature(new TextEncoder().encode('{"text":"반달 동기화"}'), valid, TEST_SECRET, TEST_NOW.getTime())).rejects.toMatchObject({ code: 'invalid_signature' })
  })
  it('rejects expired and future replays, duplicate timestamps and wrong destinations', async () => {
    const body = new TextEncoder().encode('{}'), header = await signature(body)
    for (const time of [TEST_NOW.getTime() - 6000, TEST_NOW.getTime() + 6000]) await expect(verifySignature(body, header, TEST_SECRET, time)).rejects.toMatchObject({ code: 'invalid_signature' })
    await expect(verifySignature(body, `${header};ts=1791849600`, TEST_SECRET, TEST_NOW.getTime())).rejects.toMatchObject({ code: 'invalid_signature' })
    await expect(verifySignature(body, header, `${TEST_SECRET}_other`, TEST_NOW.getTime())).rejects.toMatchObject({ code: 'invalid_signature' })
    await expect(verifySignature(body, header.replace(/h1=.*/, 'h1=abc'), TEST_SECRET, TEST_NOW.getTime())).rejects.toMatchObject({ code: 'invalid_signature' })
  })
  it('uses the complete base64-shaped endpoint secret as UTF-8, including plus, slash and padding', async () => {
    const secret = 'pdl_ntfset_dGVzdC+/AA==', raw = new TextEncoder().encode('{"fixture":"not a real secret"}'), header = await signature(raw, TEST_NOW, secret)
    await expect(verifySignature(raw, header, secret, TEST_NOW.getTime())).resolves.toBeUndefined()
    await expect(verifySignature(raw, header, secret.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''), TEST_NOW.getTime())).rejects.toMatchObject({ code: 'invalid_signature' })
    await expect(verifySignature(raw, header, atob(secret.slice('pdl_ntfset_'.length)), TEST_NOW.getTime())).rejects.toMatchObject({ code: 'invalid_signature' })
  })
  it('bounds streamed bodies even without an honest content-length', async () => {
    const request = new Request('https://example.test', { method: 'POST', body: 'a'.repeat(33) })
    await expect(boundedBody(request, 32)).rejects.toMatchObject({ code: 'body_too_large', status: 413 })
  })
})

describe('paid subscription evidence', () => {
  it.each(['monthly', 'annual'] as const)('accepts a fully captured fixed %s price', plan => {
    const payment = paidTransaction(transactionFixture(plan))
    expect(payment.amount).toBe(plan === 'monthly' ? 4900 : 49000)
    expect(payment.currency).toBe('KRW')
    expect(planFromItems([priceItem(plan)])).toBe(plan)
  })
  it.each([
    ['status', (t: any) => { t.status = 'paid' }],
    ['currency', (t: any) => { t.currency_code = 'USD' }],
    ['total currency', (t: any) => { t.details.totals.currency_code = 'USD' }],
    ['quantity', (t: any) => { t.items[0].quantity = 2 }],
    ['second item', (t: any) => { t.items.push(priceItem()) }],
    ['price id', (t: any) => { t.items[0].price.id = `pri_${'x'.repeat(26)}` }],
    ['unit amount', (t: any) => { t.items[0].price.unit_price.amount = '1' }],
    ['tax mode', (t: any) => { t.items[0].price.tax_mode = 'external' }],
    ['billing interval', (t: any) => { t.items[0].price.billing_cycle.interval = 'year' }],
    ['billing frequency', (t: any) => { t.items[0].price.billing_cycle.frequency = 2 }],
    ['trial', (t: any) => { t.items[0].price.trial_period = { interval: 'day', frequency: 7 } }],
    ['balance', (t: any) => { t.details.totals.balance = '4900' }],
    ['tax/total mismatch', (t: any) => { t.details.totals.total = '5390' }],
    ['credit', (t: any) => { t.details.totals.credit = '4900' }],
    ['discount', (t: any) => { t.discount_id = 'dsc_test' }],
    ['unsettled capture', (t: any) => { t.payments[0].status = 'authorized' }],
    ['underpayment', (t: any) => { t.payments[0].amount = '1' }],
    ['refund', (t: any) => { t.details.adjusted_totals.grand_total = '0' }],
    ['invalid period', (t: any) => { t.billing_period.ends_at = t.billing_period.starts_at }],
    ['monthly overgrant', (t: any) => { t.billing_period.ends_at = '2027-10-12T00:00:00Z' }],
    ['missing subscription', (t: any) => { t.subscription_id = null }]
  ])('rejects %s instead of granting access', (_name, mutate) => {
    const fixture = transactionFixture(); mutate(fixture)
    expect(() => paidTransaction(fixture)).toThrow()
  })
  it('rejects annual overgrant and accepts canceled state with no billing period', () => {
    const annual = transactionFixture('annual'); annual.billing_period.ends_at = '2028-10-12T00:00:00Z'
    expect(() => paidTransaction(annual)).toThrow()
    const canceled = { ...subscriptionFixture(), status: 'canceled', current_billing_period: null }
    expect(subscriptionSnapshot(canceled)).toMatchObject({ status: 'canceled', period_ends_at: null })
  })
  it('preserves scheduled cancellation without converting active to canceled', () => {
    const source = subscriptionFixture(); source.scheduled_change = { action: 'cancel', effective_at: '2026-11-12T00:00:00Z' }
    expect(subscriptionSnapshot(source)).toMatchObject({ status: 'active', scheduled_action: 'cancel', scheduled_at: '2026-11-12T00:00:00Z' })
  })
})
