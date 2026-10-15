import { createClient } from '@supabase/supabase-js'
import { SANDBOX_PRICES, type BillingEnvironment } from './policy.ts'
import { createBillingService, type BillingConfig } from './service.ts'

// The deployed entrypoint fixes the environment. Shared project secrets cannot
// silently turn the existing Sandbox endpoint into a real charging endpoint.
export function runtime(env: (key: string) => string | undefined, environment: BillingEnvironment = 'sandbox') {
  const webOrigin = env('PADDLE_BILLING_WEB_ORIGIN') ?? 'https://bandal.io', url = new URL(webOrigin)
  if (url.protocol !== 'https:' || url.origin !== webOrigin) throw new Error('Invalid billing web origin')
  const live = environment === 'live', prefix = live ? 'PADDLE_LIVE' : 'PADDLE_SANDBOX'
  const config: BillingConfig = {
    enabled: env(live ? 'PADDLE_LIVE_BILLING_ENABLED' : 'PADDLE_BILLING_ENABLED') === 'true', environment, webOrigin,
    supabaseUrl: env('SUPABASE_URL') ?? '', supabaseAnonKey: env('SUPABASE_ANON_KEY') ?? '',
    apiKey: env(`${prefix}_API_KEY`) ?? '', clientToken: env(`${prefix}_CLIENT_TOKEN`) ?? '', webhookSecret: env(`${prefix}_WEBHOOK_SECRET`) ?? '',
    prices: live ? {
      monthly: { id: env('PADDLE_LIVE_MONTHLY_PRICE_ID') ?? '', amount: 4900, interval: 'month' },
      annual: { id: env('PADDLE_LIVE_ANNUAL_PRICE_ID') ?? '', amount: 49000, interval: 'year' }
    } : SANDBOX_PRICES,
    publicCheckout: live && env('PADDLE_LIVE_CHECKOUT_PUBLIC_ENABLED') === 'true',
    checkoutAllowedUserIds: (env('PADDLE_LIVE_CHECKOUT_ALLOWED_USER_IDS') ?? '').split(',').map(value => value.trim()).filter(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)),
    allowedUserIds: (env('PADDLE_SANDBOX_ALLOWED_USER_IDS') ?? '').split(',').map(value => value.trim()).filter(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  }
  const db = createClient(config.supabaseUrl, env('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  return createBillingService(db, config)
}
