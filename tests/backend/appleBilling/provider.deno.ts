import { createAppleProvider } from '../../../supabase/functions/_shared/apple-billing/provider.ts'
import { AppleBillingError, type AppleConfig } from '../../../supabase/functions/_shared/apple-billing/policy.ts'
const c: AppleConfig = { enabled: false, environment: 'production', bundleId: 'app.bandal.ipad', appAppleId: 1234567890, groupId: '12345', issuerId: '11111111-1111-4111-8111-111111111111', keyId: 'AAAAAAAAAA', privateKey: '-----BEGIN PRIVATE KEY-----\nnot-used-without-api-calls\n-----END PRIVATE KEY-----', productIds: { monthly: 'app.bandal.ipad.sync.monthly', annual: 'app.bandal.ipad.sync.yearly' }, allowedUserIds: [], webOrigin: 'https://bandal.io' }
Deno.test('official Apple verifier rejects unsigned, forged and untrusted local payloads', async () => {
  const provider = createAppleProvider(c)
  for (const jws of ['invalid', [btoa(JSON.stringify({ alg: 'none' })), btoa(JSON.stringify({ environment: 'Production', bundleId: c.bundleId })), ''].join('.'), [btoa(JSON.stringify({ alg: 'ES256', x5c: [] })), btoa('{}'), btoa('fake-signature')].join('.')]) {
    let rejected = false
    try { await provider.transaction(jws) } catch (error) { rejected = error instanceof AppleBillingError && error.code === 'invalid_apple_signature' }
    if (!rejected) throw new Error('Untrusted transaction was not rejected')
    rejected = false
    try { await provider.notification(jws) } catch (error) { rejected = error instanceof AppleBillingError && error.code === 'invalid_apple_signature' }
    if (!rejected) throw new Error('Untrusted notification was not rejected')
  }
})
