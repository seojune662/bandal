export type Environment = 'production' | 'sandbox'
export type Json = Record<string, unknown>
export class AppleBillingError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export interface AppleConfig {
  enabled: boolean; environment: Environment; bundleId: string; appAppleId: number;
  issuerId: string; keyId: string; privateKey: string; groupId: string;
  productIds: { monthly: string; annual: string }; allowedUserIds: string[]; webOrigin: string
}
export function configured(c: AppleConfig): boolean {
  return c.bundleId === 'app.bandal.ipad' && Number.isSafeInteger(c.appAppleId) && c.appAppleId > 0
    && /^[0-9a-f-]{36}$/i.test(c.issuerId) && /^[A-Z0-9]{10}$/.test(c.keyId)
    && c.privateKey.startsWith('-----BEGIN PRIVATE KEY-----') && /^\d+$/.test(c.groupId)
    && Object.values(c.productIds).every(v => /^app\.bandal\.ipad\.sync\.[a-z.]+$/.test(v))
    && c.productIds.monthly !== c.productIds.annual
}
export function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppleBillingError('invalid_apple_data', 502)
  return value as Json
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,80}$/.test(value)) throw new AppleBillingError('invalid_apple_data', 502)
  return value
}
export function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AppleBillingError('apple_account_token_required', 409)
  return value.toLowerCase()
}
function date(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 8640000000000000) throw new AppleBillingError('invalid_apple_data', 502)
  return new Date(value).toISOString()
}
export function validateTransaction(value: unknown, c: AppleConfig): Json {
  const t = object(value)
  if (t.environment !== (c.environment === 'production' ? 'Production' : 'Sandbox')) throw new AppleBillingError('apple_environment_mismatch', 403)
  if (t.bundleId !== c.bundleId || t.type !== 'Auto-Renewable Subscription' || t.subscriptionGroupIdentifier !== c.groupId
    || !Object.values(c.productIds).includes(String(t.productId)) || t.inAppOwnershipType !== 'PURCHASED'
    || t.quantity !== 1) throw new AppleBillingError('apple_product_mismatch', 409)
  identifier(t.transactionId); identifier(t.originalTransactionId); token(t.appAccountToken)
  date(t.purchaseDate); date(t.expiresDate); date(t.signedDate)
  return t
}
export function snapshot(transaction: unknown, renewal: unknown, status: unknown, c: AppleConfig): Json {
  const t = validateTransaction(transaction, c), r = object(renewal)
  if (r.environment !== t.environment || r.originalTransactionId !== t.originalTransactionId || r.productId !== t.productId
    || (r.appAccountToken != null && token(r.appAccountToken) !== token(t.appAccountToken))
    || ![0, 1].includes(Number(r.autoRenewStatus)) || ![1, 2, 3, 4, 5].includes(Number(status))) throw new AppleBillingError('apple_transaction_mismatch', 409)
  if (r.autoRenewProductId != null && !Object.values(c.productIds).includes(String(r.autoRenewProductId))) throw new AppleBillingError('apple_product_mismatch', 409)
  if (t.isUpgraded === true && Number(status) === 1) throw new AppleBillingError('apple_transaction_mismatch', 409)
  const signedAt = date(Math.min(Number(t.signedDate), Number(r.signedDate)))
  if (Number(status) === 4 && r.gracePeriodExpiresDate == null) throw new AppleBillingError('invalid_apple_data', 502)
  const percentage = t.revocationPercentage
  if (percentage != null && (typeof percentage !== 'number' || !Number.isInteger(percentage) || percentage < 0 || percentage > 100000)) throw new AppleBillingError('invalid_apple_data', 502)
  return { appAccountToken: token(t.appAccountToken), originalTransactionId: identifier(t.originalTransactionId), transactionId: identifier(t.transactionId),
    productId: t.productId, plan: t.productId === c.productIds.monthly ? 'monthly' : 'annual', status: Number(status),
    purchasedAt: date(t.purchaseDate), expiresAt: date(t.expiresDate), graceExpiresAt: r.gracePeriodExpiresDate == null ? null : date(r.gracePeriodExpiresDate),
    autoRenew: Number(r.autoRenewStatus) === 1, revokedAt: t.revocationDate == null ? null : date(t.revocationDate),
    revocationType: t.revocationType ?? null, revocationPercentage: percentage ?? null, signedAt }
}
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
}
export async function body(request: Request, limit = 262144): Promise<Json> {
  const reader = request.body?.getReader(); if (!reader) throw new AppleBillingError('invalid_request')
  const chunks: Uint8Array[] = []; let size = 0
  while (true) {
    const part = await reader.read(); if (part.done) break
    size += part.value.length; if (size > limit) { await reader.cancel(); throw new AppleBillingError('body_too_large', 413) }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) } catch { throw new AppleBillingError('invalid_request') }
}
