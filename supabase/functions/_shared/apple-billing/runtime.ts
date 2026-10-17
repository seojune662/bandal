import { createClient } from '@supabase/supabase-js'
import { configured, type AppleConfig, type Environment } from './policy.ts'
import { createAppleProvider } from './provider.ts'
import { createAppleBillingService } from './service.ts'
export function runtime(env: (key: string) => string | undefined, environment: Environment = 'production') {
  const prefix = environment === 'production' ? 'APPLE' : 'APPLE_SANDBOX'
  const c: AppleConfig = {
    enabled: env(`${prefix}_BILLING_ENABLED`) === 'true', environment, bundleId: 'app.bandal.ipad',
    appAppleId: Number(env('APPLE_APP_ID') ?? 0), groupId: env('APPLE_SUBSCRIPTION_GROUP_ID') ?? '',
    issuerId: env(`${prefix}_ISSUER_ID`) ?? '', keyId: env(`${prefix}_KEY_ID`) ?? '', privateKey: env(`${prefix}_PRIVATE_KEY`) ?? '',
    productIds: { monthly: env('APPLE_MONTHLY_PRODUCT_ID') ?? 'app.bandal.ipad.sync.monthly', annual: env('APPLE_ANNUAL_PRODUCT_ID') ?? 'app.bandal.ipad.sync.yearly' },
    allowedUserIds: (env('APPLE_SANDBOX_ALLOWED_USER_IDS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    webOrigin: 'https://bandal.io'
  }
  const db = createClient(env('SUPABASE_URL') ?? '', env('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  return createAppleBillingService(db, c, configured(c) ? createAppleProvider(c) : null)
}
