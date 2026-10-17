import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'npm:jose@6.1.3'
import { authorizationConfigured, DeletionError, type AppleAuthorizationConfig } from './policy.ts'
export type AppleAuthorizationProvider = { exchange(code: string, expectedSubject: string): Promise<string>; revoke(refreshToken: string): Promise<void> }
const clientId = 'app.bandal.ipad'
const keys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'), { timeoutDuration: 10000 })
export function createAppleAuthorizationProvider(c: AppleAuthorizationConfig): AppleAuthorizationProvider | null {
  if (!authorizationConfigured(c)) return null
  async function post(path: 'token' | 'revoke', fields: Record<string, string>): Promise<Response> {
    const key = await importPKCS8(c.privateKey, 'ES256')
    const secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: c.keyId }).setIssuer(c.teamId)
      .setIssuedAt().setExpirationTime('5m').setAudience('https://appleid.apple.com').setSubject(clientId).sign(key)
    try {
      return await fetch(`https://appleid.apple.com/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, ...fields }), signal: AbortSignal.timeout(10000), redirect: 'error' })
    } catch { throw new DeletionError('apple_authorization_unavailable', 503) }
  }
  return {
    async exchange(code, expectedSubject) {
      const response = await post('token', { grant_type: 'authorization_code', code })
      if (!response.ok) throw new DeletionError(response.status === 400 ? 'apple_authorization_rejected' : 'apple_authorization_unavailable', response.status === 400 ? 409 : 503)
      // Apple is the fixed authenticated endpoint. Bound the response as well as
      // the request; never put its errors or token values in client responses.
      const text = await response.text()
      if (text.length > 32768) throw new DeletionError('apple_authorization_unavailable', 503)
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { throw new DeletionError('apple_authorization_unavailable', 503) }
      if (typeof data.id_token !== 'string' || typeof data.refresh_token !== 'string' || data.refresh_token.length > 16384) throw new DeletionError('apple_authorization_unavailable', 503)
      try {
        const result = await jwtVerify(data.id_token, keys, { issuer: 'https://appleid.apple.com', audience: clientId, algorithms: ['RS256'], clockTolerance: 10 })
        if (result.payload.sub !== expectedSubject) throw new Error('mismatch')
      } catch { throw new DeletionError('apple_identity_mismatch', 403) }
      return data.refresh_token
    },
    async revoke(refreshToken) {
      const response = await post('revoke', { token: refreshToken, token_type_hint: 'refresh_token' })
      if (!response.ok) throw new DeletionError('apple_revocation_unavailable', 503)
    }
  }
}
