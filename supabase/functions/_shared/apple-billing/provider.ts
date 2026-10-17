import { Buffer } from 'node:buffer'
import { AppStoreServerAPIClient, Environment as AppleEnvironment, SignedDataVerifier, VerificationException, VerificationStatus } from 'npm:@apple/app-store-server-library@3.1.0'
import { APPLE_ROOT_CERTIFICATES } from './certificates.ts'
import { AppleBillingError, object, snapshot, validateTransaction, type AppleConfig, type Json } from './policy.ts'
export interface AppleProvider {
  transaction(jws: string): Promise<Json>
  notification(jws: string): Promise<Json>
  current(originalTransactionId: string): Promise<Json>
}
export function createAppleProvider(c: AppleConfig): AppleProvider {
  const env = c.environment === 'production' ? AppleEnvironment.PRODUCTION : AppleEnvironment.SANDBOX
  const verifier = new SignedDataVerifier(APPLE_ROOT_CERTIFICATES.map(value => Buffer.from(value, 'base64')), true, env, c.bundleId, c.appAppleId)
  const client = new AppStoreServerAPIClient(c.privateKey, c.keyId, c.issuerId, c.bundleId, env)
  async function verified<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof VerificationException && error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) throw new AppleBillingError('apple_provider_unavailable', 503)
      if (error instanceof VerificationException && error.status === VerificationStatus.INVALID_ENVIRONMENT) throw new AppleBillingError('apple_environment_mismatch', 403)
      throw new AppleBillingError('invalid_apple_signature', 401)
    }
  }
  return {
    async transaction(jws) { return validateTransaction(await verified(() => verifier.verifyAndDecodeTransaction(jws)), c) },
    async notification(jws) {
      const event = object(await verified(() => verifier.verifyAndDecodeNotification(jws)))
      // Validate every signed nested object even though current state comes from
      // Apple's API. Never interpret a merely base64-decoded notification.
      if (event.data) {
        const data = object(event.data)
        if (data.signedTransactionInfo) await verified(() => verifier.verifyAndDecodeTransaction(String(data.signedTransactionInfo)))
        if (data.signedRenewalInfo) await verified(() => verifier.verifyAndDecodeRenewalInfo(String(data.signedRenewalInfo)))
      }
      return event
    },
    async current(originalId) {
      let response
      try { response = await client.getAllSubscriptionStatuses(originalId) } catch { throw new AppleBillingError('apple_provider_unavailable', 503) }
      if (response.bundleId !== c.bundleId || response.environment !== env || (env === AppleEnvironment.PRODUCTION && response.appAppleId !== c.appAppleId)) throw new AppleBillingError('apple_transaction_mismatch', 409)
      for (const group of response.data ?? []) {
        if (group.subscriptionGroupIdentifier !== c.groupId) continue
        for (const item of group.lastTransactions ?? []) {
          if (item.originalTransactionId !== originalId) continue
          if (!item.signedTransactionInfo || !item.signedRenewalInfo) throw new AppleBillingError('invalid_apple_data', 502)
          const t = await verified(() => verifier.verifyAndDecodeTransaction(item.signedTransactionInfo!))
          const r = await verified(() => verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo!))
          if (t.originalTransactionId !== originalId) throw new AppleBillingError('apple_transaction_mismatch', 409)
          return snapshot(t, r, item.status, c)
        }
      }
      throw new AppleBillingError('apple_subscription_not_found', 409)
    }
  }
}
