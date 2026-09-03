/**
 * The one and only Supabase client — owned by the MAIN process.
 *
 * Why main and not the renderer (docs/phase2-community.md §4.2):
 *  1. Token isolation. This renderer hosts `<webview>` guests loading
 *     arbitrary web pages and renders remote markdown through Milkdown. A
 *     refresh token there turns one XSS into account takeover. In main, the
 *     most an XSS can reach is the typed IPC surface — already narrowed by
 *     RLS and the main-side rateGuard.
 *  2. It matches the existing architecture: main is the source of truth, the
 *     renderer hydrates and invalidates on push.
 *  3. The outbox must survive renderer reloads, and SQLite lives in main.
 *  4. Channel lifetimes behave like the CLI processes SessionManager already
 *     manages (idle reap, LRU, abrupt quit).
 *  5. The renderer CSP never has to allow `*.supabase.co`.
 *
 * Construction is LAZY. Nothing in this module runs unless an `auth:*` or
 * `groups:*` invoke arrives (§1.4-2).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig, type SupabaseConfig } from './config'
import type { SupabaseStorageAdapter } from './sessionStore'

export interface SupabaseClientDeps {
  storage: SupabaseStorageAdapter
  config?: SupabaseConfig
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
    realtime: {
      params: {
        // Broadcast-from-database fans out one message per change; a low
        // events-per-second cap is plenty and protects the free-tier quota.
        eventsPerSecond: 10
      }
    },
    global: {
      headers: { 'x-bandal-client': 'desktop' }
    }
  })
}

/** Postgres error shape as surfaced by PostgREST / supabase-js. */
export interface PostgresErrorLike {
  code?: string
  message?: string
  details?: string
  hint?: string
}

export function asPostgresError(error: unknown): PostgresErrorLike | null {
  if (typeof error !== 'object' || error === null) return null
  const record = error as Record<string, unknown>
  const out: PostgresErrorLike = {}
  if (typeof record['code'] === 'string') out.code = record['code']
  if (typeof record['message'] === 'string') out.message = record['message']
  if (typeof record['details'] === 'string') out.details = record['details']
  if (typeof record['hint'] === 'string') out.hint = record['hint']
  return out
}

/**
 * Every rate limit in the schema — RPC guard and message token bucket alike —
 * reports `P0001 / 'rate_limited'`, deliberately unified so main branches once
 * (supabase/README.md §5.2). HINT carries the seconds until retry.
 */
export function isRateLimited(error: unknown): boolean {
  const pg = asPostgresError(error)
  return pg?.code === 'P0001' && pg.message === 'rate_limited'
}

export function retryAfterSeconds(error: unknown): number | null {
  const pg = asPostgresError(error)
  const parsed = Number(pg?.hint ?? '')
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : null
}
