import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * bandal.io/admin API. The browser sends its Supabase access token; this
 * handler checks it with Auth and asks the database whether the user is an
 * approved operator (admin_operators). Only then does it return aggregates.
 *
 * Actions (POST JSON):
 * - `config`: the public Supabase URL and anon key the page signs in with.
 * - `me`: 200 for an operator, 403 for anyone else.
 * - `overview` `{from, to}`: dashboard aggregates; each read is audited.
 */
export class AdminError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code) }
}

export interface AdminConfig { supabaseUrl: string; supabaseAnonKey: string; origins: string[] }

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
      if (input.action !== 'me' && input.action !== 'overview') throw new AdminError('invalid_request')

      const authorization = request.headers.get('authorization') ?? ''
      if (!authorization.startsWith('Bearer ') || authorization.length > 16384) throw new AdminError('sign_in_required', 401)
      const user = await db.auth.getUser(authorization.slice(7))
      if (user.error || !user.data.user || user.data.user.is_anonymous) throw new AdminError('sign_in_required', 401)
      const actor = user.data.user.id
      const operator = await db.rpc('bandal_admin_is_operator', { actor })
      if (operator.error) throw new AdminError('admin_unavailable', 503)
      if (operator.data !== true) throw new AdminError('admin_required', 403)

      if (input.action === 'me') return respond({ operator: true, email: user.data.user.email ?? null })
      const { from, to } = parseRange(input)
      const overview = await db.rpc('bandal_admin_overview', { actor, from_input: from, to_input: to })
      if (overview.error) {
        if (overview.error.message === 'admin_required') throw new AdminError('admin_required', 403)
        if (overview.error.message === 'admin_invalid_range') throw new AdminError('invalid_range')
        throw new AdminError('admin_unavailable', 503)
      }
      // The audit row is part of the read: no record, no data.
      const audit = await db.from('admin_audit').insert({ actor, action: 'overview', range_from: from, range_to: to })
      if (audit.error) throw new AdminError('admin_unavailable', 503)
      return respond(overview.data)
    } catch (error) {
      const known = error instanceof AdminError ? error : new AdminError('admin_unavailable', 503)
      return respond({ error: known.code }, known.status)
    }
  }
}
