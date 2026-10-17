import type { SupabaseClient } from '@supabase/supabase-js'
import { body } from '../apple-billing/policy.ts'
import type { AppleAuthorizationProvider } from './apple.ts'
import { DeletionError, recentAuthentication, openToken, sealToken } from './policy.ts'
const safe = new Set(['account_deletion_pending_transactions', 'account_deletion_in_progress', 'account_deletion_storage_pending'])
export function createAccountDeletionService(db: SupabaseClient, apple: AppleAuthorizationProvider | null, encryptionKey: string) {
  async function checked<T>(result: { data: T; error: unknown }): Promise<T> {
    if (result.error) {
      const message = typeof result.error === 'object' && result.error && 'message' in result.error ? String(result.error.message) : ''
      throw new DeletionError(safe.has(message) ? message : 'account_deletion_unavailable', safe.has(message) ? 409 : 503)
    }
    return result.data
  }
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin'), headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }
    if (origin === 'https://bandal.io') Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' })
    const respond = (value: unknown, status = 200) => Response.json(value, { status, headers })
    try {
      if (origin && origin !== 'https://bandal.io') throw new DeletionError('origin_not_allowed', 403)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (request.method !== 'POST') throw new DeletionError('method_not_allowed', 405)
      const authorization = request.headers.get('authorization') ?? ''
      if (!authorization.startsWith('Bearer ') || authorization.length > 16384) throw new DeletionError('sign_in_required', 401)
      const jwt = authorization.slice(7), userResult = await db.auth.getUser(jwt)
      if (userResult.error || !userResult.data.user) throw new DeletionError('sign_in_required', 401)
      const user = userResult.data.user, actor = user.id
      const claims = await db.auth.getClaims(jwt)
      if (claims.error || !claims.data || !recentAuthentication(claims.data.claims, actor)) throw new DeletionError('reauthentication_required', 401)
      let input: Record<string, unknown>
      try { input = await body(request) } catch { throw new DeletionError('invalid_request') }
      const appleIdentity = user.identities?.find(identity => identity.provider === 'apple')
      if (input.action === 'registerAppleAuthorization') {
        if (Object.keys(input).some(key => !['action', 'authorizationCode'].includes(key)) || typeof input.authorizationCode !== 'string' || input.authorizationCode.length < 8 || input.authorizationCode.length > 4096) throw new DeletionError('invalid_request')
        const subject = appleIdentity?.identity_data?.sub
        if (typeof subject !== 'string' || !subject) throw new DeletionError('apple_identity_required', 403)
        if (!apple || !encryptionKey) throw new DeletionError('apple_authorization_unavailable', 503)
        const refreshToken = await apple.exchange(input.authorizationCode, subject), sealed = await sealToken(refreshToken, actor, encryptionKey)
        await checked(await db.rpc('bandal_apple_authorization_store', { actor, ciphertext_input: sealed.ciphertext, iv_input: sealed.iv }))
        return respond({ ok: true })
      }
      if (input.confirm !== true || Object.keys(input).some(key => key !== 'confirm')) throw new DeletionError('confirmation_required')
      const beginning = await checked(await db.rpc('bandal_account_deletion_begin', { actor }))
      if (beginning?.started === false) return respond({ error: 'account_deletion_pending_transactions', pendingTransactions: beginning.pendingTransactions }, 409)
      const credential = await checked(await db.from('bandal_apple_authorizations').select('iv,ciphertext,revoked_at').eq('user_id', actor).maybeSingle())
      let appleRevocation = appleIdentity ? 'manual_required' : 'not_applicable'
      if (credential) {
        if (!credential.revoked_at) {
          if (!apple || !encryptionKey) throw new DeletionError('apple_revocation_unavailable', 503)
          await apple.revoke(await openToken(credential, actor, encryptionKey))
          await checked(await db.from('bandal_apple_authorizations').update({ revoked_at: new Date().toISOString() }).eq('user_id', actor))
        }
        appleRevocation = 'revoked'
      }
      // Bounded, resumable batches. Query authoritative object metadata, including
      // orphans; remove through Storage API so bytes and metadata disappear together.
      for (let attempt = 0; attempt < 20; attempt++) {
        const objects = await checked(await db.rpc('bandal_account_deletion_assets', { actor })) as { bucket_id: string; name: string }[]
        if (!objects.length) break
        for (const bucket of new Set(objects.map(object => object.bucket_id))) {
          await checked(await db.storage.from(bucket).remove(objects.filter(object => object.bucket_id === bucket).map(object => object.name)))
        }
      }
      const remaining = await checked(await db.rpc('bandal_account_deletion_assets', { actor })) as unknown[]
      if (remaining.length) throw new DeletionError('account_deletion_storage_pending', 409)
      await checked(await db.rpc('bandal_account_deletion_cleanup', { actor }))
      // Auth deletion is last. Any FK or provider outage leaves a resumable job
      // and never returns ok while files or the authentication identity remain.
      const deleted = await db.auth.admin.deleteUser(actor)
      if (deleted.error) throw new DeletionError('account_deletion_unavailable', 503)
      // Completion receipt is best-effort only after Auth confirms deletion.
      await db.from('bandal_account_deletions').update({ completed_at: new Date().toISOString() }).eq('user_id', actor)
      return respond({ ok: true, appleRevocation })
    } catch (error) {
      const known = error instanceof DeletionError ? error : new DeletionError('account_deletion_unavailable', 503)
      return respond({ error: known.code }, known.status)
    }
  }
}
