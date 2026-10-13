export class BillingError extends Error {
  constructor(public code: string, public status = 400) { super(code) }
}

export const SANDBOX_PRICES = {
  monthly: { id: 'pri_01m4tkfz9fnqcsq4ah67e092j8', amount: 4900, interval: 'month' },
  annual: { id: 'pri_01m4tkhwzp9bhpq2yt03em2c7g', amount: 49000, interval: 'year' }
} as const
export type Plan = keyof typeof SANDBOX_PRICES
export type JsonObject = Record<string, unknown>
export const STORAGE_BYTES = 5 * 1024 ** 3

export function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BillingError('invalid_provider_data', 502)
  return value as JsonObject
}
export function identifier(value: unknown, prefix: 'txn' | 'sub' | 'ctm' | 'evt'): string {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value)) throw new BillingError('invalid_provider_data', 502)
  return value
}
export function webhookEventIdentifier(value: unknown): string {
  // The Sandbox simulator uses its simulation-event ID in event_id. Keep this
  // exception confined to webhook receipts; entity IDs and API receipts differ.
  if (typeof value !== 'string' || !/^(?:evt|ntfsimevt)_[a-z0-9]{26}$/.test(value)) throw new BillingError('invalid_provider_data', 502)
  return value
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BillingError('invalid_request_id')
  return value
}
export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new BillingError('invalid_provider_data', 502)
  return value
}
export function planFromItems(value: unknown): Plan {
  if (!Array.isArray(value) || value.length !== 1) throw new BillingError('price_mismatch', 409)
  const item = object(value[0]), price = object(item.price)
  const plan = (Object.keys(SANDBOX_PRICES) as Plan[]).find(key => SANDBOX_PRICES[key].id === price.id)
  if (!plan || item.quantity !== 1) throw new BillingError('price_mismatch', 409)
  const expected = SANDBOX_PRICES[plan], unit = object(price.unit_price), cycle = object(price.billing_cycle)
  if (unit.currency_code !== 'KRW' || unit.amount !== String(expected.amount) || cycle.interval !== expected.interval || cycle.frequency !== 1 || price.trial_period != null || price.tax_mode !== 'internal') throw new BillingError('price_mismatch', 409)
  return plan
}

export interface SubscriptionSnapshot {
  id: string; customer_id: string; price_id: string; plan: Plan; status: string;
  updated_at: string; period_starts_at: string | null; period_ends_at: string | null;
  scheduled_action: string | null; scheduled_at: string | null
}
export function subscriptionSnapshot(value: unknown): SubscriptionSnapshot {
  const row = object(value), plan = planFromItems(row.items)
  if (row.currency_code !== 'KRW' || row.collection_mode !== 'automatic' || !['active', 'past_due', 'paused', 'canceled', 'trialing'].includes(String(row.status))) throw new BillingError('subscription_mismatch', 409)
  const period = row.current_billing_period == null ? null : object(row.current_billing_period)
  const change = row.scheduled_change == null ? null : object(row.scheduled_change)
  const starts = period ? timestamp(period.starts_at) : null, ends = period ? timestamp(period.ends_at) : null
  if (starts && ends && Date.parse(ends) <= Date.parse(starts)) throw new BillingError('invalid_provider_data', 502)
  if (change && !['cancel', 'pause', 'resume'].includes(String(change.action))) throw new BillingError('invalid_provider_data', 502)
  return {
    id: identifier(row.id, 'sub'), customer_id: identifier(row.customer_id, 'ctm'),
    price_id: SANDBOX_PRICES[plan].id, plan, status: String(row.status), updated_at: timestamp(row.updated_at),
    period_starts_at: starts, period_ends_at: ends,
    scheduled_action: change ? String(change.action) : null, scheduled_at: change ? timestamp(change.effective_at) : null
  }
}
export interface PaymentSnapshot {
  id: string; subscription_id: string; customer_id: string; price_id: string; amount: number;
  currency: 'KRW'; period_starts_at: string; period_ends_at: string
}
export function paidTransaction(value: unknown): PaymentSnapshot {
  const row = object(value), plan = planFromItems(row.items), details = object(row.details), totals = object(details.totals)
  const amount = SANDBOX_PRICES[plan].amount
  if (row.status !== 'completed' || row.currency_code !== 'KRW' || row.collection_mode !== 'automatic' || row.discount_id != null || totals.currency_code !== 'KRW' || totals.grand_total !== String(amount) || totals.total !== String(amount) || totals.balance !== '0' || totals.credit !== '0' || totals.discount !== '0') throw new BillingError('payment_not_confirmed', 409)
  // A completed administrative/zero-value transaction must never grant access.
  const captured = Array.isArray(row.payments) ? row.payments.reduce((sum: number, payment: unknown) => {
    const p = object(payment)
    return sum + (p.status === 'captured' && typeof p.amount === 'string' && /^\d+$/.test(p.amount) ? Number(p.amount) : 0)
  }, 0) : 0
  if (captured !== amount) throw new BillingError('payment_not_confirmed', 409)
  const adjusted = details.adjusted_totals == null ? null : object(details.adjusted_totals)
  if (adjusted && adjusted.grand_total !== String(amount)) throw new BillingError('payment_adjusted', 409)
  const period = object(row.billing_period), starts = timestamp(period.starts_at), ends = timestamp(period.ends_at)
  const days = (Date.parse(ends) - Date.parse(starts)) / 86400000
  if (days <= 0 || days > (plan === 'monthly' ? 32 : 367)) throw new BillingError('invalid_billing_period', 409)
  return { id: identifier(row.id, 'txn'), subscription_id: identifier(row.subscription_id, 'sub'), customer_id: identifier(row.customer_id, 'ctm'), price_id: SANDBOX_PRICES[plan].id, amount, currency: 'KRW', period_starts_at: starts, period_ends_at: ends }
}

const encoder = new TextEncoder()
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('')
}
function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const row = value as JsonObject
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`
  }
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value)
  throw new BillingError('invalid_event', 400)
}
export async function eventDigest(event: JsonObject): Promise<string> {
  // A replay creates a new notification_id for the same immutable event.
  // Canonicalize only receipt identity/content AFTER verifying the raw HMAC;
  // this must never replace the original bytes used by verifySignature.
  return sha256(encoder.encode(canonicalJson({
    event_id: event.event_id, event_type: event.event_type, occurred_at: event.occurred_at, data: event.data
  })))
}
export async function verifySignature(raw: Uint8Array, header: string | null, secret: string, now = Date.now(), toleranceSeconds = 5): Promise<void> {
  if (!header || header.length > 1024 || !secret) throw new BillingError('invalid_signature', 401)
  const parts = header.split(';').map(part => part.trim()), stamps = parts.filter(part => part.startsWith('ts=')), hashes = parts.filter(part => part.startsWith('h1=')).map(part => part.slice(3))
  if (stamps.length !== 1 || !/^ts=\d{10,11}$/.test(stamps[0]!) || hashes.length < 1 || hashes.length > 8 || hashes.some(hash => !/^[a-f0-9]{64}$/i.test(hash))) throw new BillingError('invalid_signature', 401)
  const stamp = stamps[0]!.slice(3)
  if (Math.abs(now - Number(stamp) * 1000) > toleranceSeconds * 1000) throw new BillingError('invalid_signature', 401)
  const prefix = encoder.encode(`${stamp}:`), signed = new Uint8Array(prefix.length + raw.length)
  signed.set(prefix); signed.set(raw, prefix.length)
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  // WebCrypto performs the MAC comparison; no JavaScript early-exit string comparison.
  let valid = false
  for (const hash of hashes) {
    const bytes = Uint8Array.from(hash.match(/../g)!, hex => parseInt(hex, 16))
    const matches = await crypto.subtle.verify('HMAC', key, bytes, signed)
    valid = matches || valid
  }
  if (!valid) throw new BillingError('invalid_signature', 401)
}

export async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > limit) throw new BillingError('body_too_large', 413)
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    size += result.value.length
    if (size > limit) { await reader.cancel(); throw new BillingError('body_too_large', 413) }
    chunks.push(result.value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  return body
}
