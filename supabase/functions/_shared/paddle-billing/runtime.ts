import { createClient } from '@supabase/supabase-js'
import { createBillingService, type BillingConfig } from './service.ts'

export function runtime(env: (key: string) => string | undefined) {
  const webOrigin = env('PADDLE_BILLING_WEB_ORIGIN') ?? 'https://bandal.io', url = new URL(webOrigin)
  if (url.protocol !== 'https:' || url.origin !== webOrigin) throw new Error('Invalid billing web origin')
  const config: BillingConfig = {
    enabled: env('PADDLE_BILLING_ENABLED') === 'true', environment: env('PADDLE_ENVIRONMENT') ?? 'sandbox', webOrigin,
    supabaseUrl: env('SUPABASE_URL') ?? '', supabaseAnonKey: env('SUPABASE_ANON_KEY') ?? '',
    apiKey: env('PADDLE_SANDBOX_API_KEY') ?? '', clientToken: env('PADDLE_SANDBOX_CLIENT_TOKEN') ?? '', webhookSecret: env('PADDLE_SANDBOX_WEBHOOK_SECRET') ?? '',
    allowedUserIds: (env('PADDLE_SANDBOX_ALLOWED_USER_IDS') ?? '').split(',').map(value => value.trim()).filter(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  }
  const db = createClient(config.supabaseUrl, env('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  return createBillingService(db, config)
}
