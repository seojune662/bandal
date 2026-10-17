export class DeletionError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code) }
}
export function recentAuthentication(claims: Record<string, unknown>, actor: string, now = Date.now()): boolean {
  if (claims.sub !== actor || claims.role !== 'authenticated' || claims.is_anonymous === true || typeof claims.session_id !== 'string') return false
  const methods = new Set(['oauth', 'password', 'otp', 'totp', 'sso/saml', 'magiclink'])
  return Array.isArray(claims.amr) && claims.amr.some(value => {
    if (!value || typeof value !== 'object') return false
    const item = value as Record<string, unknown>, timestamp = item.timestamp
    // iat is a refresh timestamp, not evidence of reauthentication.
    return methods.has(String(item.method)) && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp * 1000 <= now + 30000 && timestamp * 1000 >= now - 600000
  })
}
export type AppleAuthorizationConfig = { teamId: string; keyId: string; privateKey: string; encryptionKey: string }
export function authorizationConfigured(c: AppleAuthorizationConfig): boolean {
  try { return /^[A-Z0-9]{10}$/.test(c.teamId) && /^[A-Z0-9]{10}$/.test(c.keyId) && c.privateKey.startsWith('-----BEGIN PRIVATE KEY-----') && atob(c.encryptionKey).length === 32 } catch { return false }
}
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value))
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))
export async function sealToken(value: string, actor: string, key: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), material = await crypto.subtle.importKey('raw', decode(key), 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(actor) }, material, new TextEncoder().encode(value))
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
}
export async function openToken(value: { iv: string; ciphertext: string }, actor: string, key: string) {
  const material = await crypto.subtle.importKey('raw', decode(key), 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.iv), additionalData: new TextEncoder().encode(actor) }, material, decode(value.ciphertext))
  return new TextDecoder().decode(plaintext)
}
