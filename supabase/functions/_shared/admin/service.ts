import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * bandal.io/admin API. The browser sends its Supabase access token; this
 * handler checks it with Auth and asks the database whether the user is an
 * approved operator (admin_operators). Only then does it return aggregates.
 *
 * Actions (POST JSON):
 * - `config`: the public Supabase URL and anon key the page signs in with.
 * - `me`: 200 for an operator, 403 for anyone else.
 * - `overview` `{from, to}`: dashboard aggregates, AI usage and cost, apps and
 *   versions in use, and server state; each read is audited.
 * - `lookup` `{query}`: one user by id, or the users whose email or nickname
 *   contains the query; audited with the user shown.
 */
export class AdminError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code) }
}

export interface AdminConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  origins: string[]
  /** Whether a secret is set; never its value. */
  hasSecret?: (name: string) => boolean
  /** Status of an OPTIONS request to a deployed function, or 0 when it did not answer. */
  probe?: (name: string) => Promise<number>
}

/** The secrets each feature needs, by the name the functions read. */
export const REQUIRED_SECRETS: readonly { feature: string; names: readonly string[] }[] = [
  { feature: 'AI (iPad)', names: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'] },
  { feature: 'App Store (iPad)', names: ['APPLE_APP_ID'] },
  { feature: 'Apple 로그인 탈퇴 연동', names: ['APPLE_AUTH_TEAM_ID', 'APPLE_AUTH_KEY_ID', 'APPLE_AUTH_PRIVATE_KEY', 'APPLE_AUTH_TOKEN_ENCRYPTION_KEY'] }
]
/** The functions the apps call; a 404 means not deployed, 5xx or no answer means down. */
export const PROBED_FUNCTIONS = ['ai-proxy', 'ipad-store', 'ipad-store-notifications', 'account-delete', 'referral', 'schools'] as const

async function serverChecks(config: AdminConfig) {
  const secrets = REQUIRED_SECRETS.map(({ feature, names }) => ({ feature, missing: names.filter(name => !(config.hasSecret?.(name) ?? false)) }))
  const functions = config.probe
    ? await Promise.all(PROBED_FUNCTIONS.map(async name => {
        const started = Date.now()
        const status = await config.probe!(name).catch(() => 0)
        return { name, status, ok: status > 0 && status < 500 && status !== 404, ms: Date.now() - started }
      }))
    : []
  return { secrets, functions }
}

const MAX_BODY = 4096
const DAY = 86_400_000

export function parseRange(input: Record<string, unknown>, now = Date.now()): { from: string; to: string } {
  const from = typeof input.from === 'string' ? Date.parse(input.from) : NaN
  const to = typeof input.to === 'string' ? Date.parse(input.to) : NaN
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 366 * DAY || to > now + DAY || from < Date.UTC(2026, 0, 1)) throw new AdminError('invalid_range')
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new AdminError('invalid_request')
  const text = await request.text()
  if (text.length > MAX_BODY) throw new AdminError('invalid_request')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new AdminError('invalid_request') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminError('invalid_request')
  return value as Record<string, unknown>
}

export function createAdminService(db: SupabaseClient, config: AdminConfig) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', Vary: 'Origin, Authorization' }
    if (origin && config.origins.includes(origin)) {
      Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Max-Age': '600' })
    }
    const respond = (value: unknown, status = 200) => Response.json(value, { status, headers })
    try {
      if (!origin || !config.origins.includes(origin)) throw new AdminError('origin_not_allowed', 403)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (request.method !== 'POST') throw new AdminError('method_not_allowed', 405)
      const input = await body(request)
      if (input.action === 'config') {
        if (!config.supabaseUrl || !config.supabaseAnonKey) throw new AdminError('not_configured', 503)
        return respond({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey })
      }
      if (input.action !== 'me' && input.action !== 'overview' && input.action !== 'lookup') throw new AdminError('invalid_request')

      const authorization = request.headers.get('authorization') ?? ''
      if (!authorization.startsWith('Bearer ') || authorization.length > 16384) throw new AdminError('sign_in_required', 401)
      const user = await db.auth.getUser(authorization.slice(7))
      if (user.error || !user.data.user || user.data.user.is_anonymous) throw new AdminError('sign_in_required', 401)
      const actor = user.data.user.id
      const operator = await db.rpc('bandal_admin_is_operator', { actor })
      if (operator.error) throw new AdminError('admin_unavailable', 503)
      if (operator.data !== true) throw new AdminError('admin_required', 403)

      if (input.action === 'me') return respond({ operator: true, email: user.data.user.email ?? null })
      const failed = (error: { message: string }) => {
        if (error.message === 'admin_required') return new AdminError('admin_required', 403)
        if (error.message === 'admin_invalid_range') return new AdminError('invalid_range')
        if (error.message === 'admin_invalid_query') return new AdminError('invalid_query')
        return new AdminError('admin_unavailable', 503)
      }
      if (input.action === 'lookup') {
        const query = typeof input.query === 'string' ? input.query.trim() : ''
        if (query.length < 2 || query.length > 254) throw new AdminError('invalid_query')
        const found = await db.rpc('bandal_admin_lookup', { actor, query })
        if (found.error) throw failed(found.error)
        const target = (found.data as { target?: string | null } | null)?.target ?? null
        // The audit row is part of the read: no record, no data.
        const audit = await db.from('admin_audit').insert({ actor, action: 'lookup', target })
        if (audit.error) throw new AdminError('admin_unavailable', 503)
        return respond(found.data)
      }
      const { from, to } = parseRange(input)
      const [overview, insights, server] = await Promise.all([
        db.rpc('bandal_admin_overview', { actor, from_input: from, to_input: to }),
        db.rpc('bandal_admin_insights', { actor, from_input: from, to_input: to }),
        serverChecks(config)
      ])
      if (overview.error) throw failed(overview.error)
      // The audit row is part of the read: no record, no data.
      const audit = await db.from('admin_audit').insert({ actor, action: 'overview', range_from: from, range_to: to })
      if (audit.error) throw new AdminError('admin_unavailable', 503)
      // Older databases have no insights yet; the page then shows the first dashboard only.
      const extra = insights.error ? { insightsError: true } : (({ range: _range, generatedAt: _generatedAt, ...rest }) => rest)(insights.data as Record<string, unknown>)
      return respond({ ...(overview.data as Record<string, unknown>), ...extra, server })
    } catch (error) {
      const known = error instanceof AdminError ? error : new AdminError('admin_unavailable', 503)
      return respond({ error: known.code }, known.status)
    }
  }
}
