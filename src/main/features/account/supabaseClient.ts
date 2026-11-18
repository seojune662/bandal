/** Main-process account client; tokens never enter the renderer. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig, type SupabaseConfig } from './config'
import type { SupabaseStorageAdapter } from './sessionStore'

export interface SupabaseClientDeps {
  storage: SupabaseStorageAdapter
  config?: SupabaseConfig
  /** Sent as User-Agent; see desktopUserAgent. */
  userAgent?: string
}

/**
 * The user agent this app sends to the Bandal server. Auth keeps it on each
 * session (auth.sessions.user_agent), and bandal.io/admin reads which app and
 * version are in use from there; nothing else is collected. Before 0.98.1 the
 * desktop app sent Node's default, "node".
 */
export function desktopUserAgent(version: string, platform: string = process.platform, arch: string = process.arch): string {
  return `Bandal-Desktop/${version} (${platform} ${arch})`
}

/**
 * Builds a configured client, or returns null when the build has no keys.
 *
 * `detectSessionInUrl: false` — there is no browser URL bar here; the PKCE
 * code arrives through the `bandal://` deep link and is exchanged explicitly.
 */
export function createSupabaseClient(
  deps: SupabaseClientDeps
): SupabaseClient | null {
  const config = deps.config ?? readSupabaseConfig()
  if (config === null) return null

  return createClient(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storage: deps.storage
    },
    global: {
      headers: { 'x-bandal-client': 'desktop', ...(deps.userAgent ? { 'User-Agent': deps.userAgent } : {}) }
    }
  })
}

