import { createClient } from '@supabase/supabase-js'
import { createAdminService } from '../_shared/admin/service.ts'
const env = (key: string) => Deno.env.get(key) ?? ''
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
// ADMIN_EXTRA_ORIGINS: exact origins for a local preview of /admin, comma-separated (e.g. http://127.0.0.1:4321). Production is bandal.io only.
const origins = ['https://bandal.io', ...env('ADMIN_EXTRA_ORIGINS').split(',').map(origin => origin.trim()).filter(origin => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))]
// Server status: whether each needed secret is set (never its value), and whether the app-facing functions answer.
const probe = async (name: string) => {
  const response = await fetch(`${env('SUPABASE_URL')}/functions/v1/${name}`, { method: 'OPTIONS', signal: AbortSignal.timeout(4000) })
  await response.body?.cancel()
  return response.status
}
Deno.serve(createAdminService(db, { supabaseUrl: env('SUPABASE_URL'), supabaseAnonKey: env('SUPABASE_ANON_KEY'), origins, hasSecret: name => env(name).length > 0, probe }))
