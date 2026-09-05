import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { inspectPluginArchive } from '../../src/shared/plugins/archive'
import { compareSemver } from '../../src/shared/plugins/semver'
import type { MarketplaceRelease } from '../../src/shared/types/marketplace'

export interface MarketplaceServerConfig {
  supabaseUrl: string
  publishableKey: string
  serviceRoleKey: string
  publicUrl: string
}
const BUCKET = 'marketplace-artifacts'
const SELECT =
  'id,plugin_id,version,manifest,sha256,changelog,status,review_reason,created_at'

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new HttpError(400, result.error.message)
  return result.data
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new HttpError(400, 'Invalid text field')
  return value.trim()
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Request body required')
  let size = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 12 * 1024 * 1024) {
      await reader.cancel()
      throw new HttpError(413, 'Request too large')
    }
    chunks.push(value)
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new HttpError(400, 'Invalid JSON body')
  return body as Record<string, unknown>
}
export function createMarketplaceService(
  config: MarketplaceServerConfig,
  makeClient = createClient,
) {
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = makeClient(config.supabaseUrl, config.serviceRoleKey, options)
  const anon = makeClient(config.supabaseUrl, config.publishableKey, options)
  async function identity(
    request: Request,
  ): Promise<{ userId: string; client: SupabaseClient }> {
    const authorization = request.headers.get('authorization') ?? ''
    if (!authorization.startsWith('Bearer '))
      throw new HttpError(401, 'Sign in required')
    const token = authorization.slice(7)
    const result = await anon.auth.getUser(token)
    if (result.error || !result.data.user)
      throw new HttpError(401, 'Session expired')
    return {
      userId: result.data.user.id,
      client: makeClient(config.supabaseUrl, config.publishableKey, {
        ...options,
        global: { headers: { Authorization: authorization } },
      }),
    }
  }
  const json = (body: unknown, status = 200): Response =>
    Response.json(body, {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const path = url.pathname.replace(/\/$/, '')
      if (request.method === 'GET' && path === '/health')
        return json({ ok: true })
      if (
        request.method === 'GET' &&
        (path === '/index.json' || path === '/releases')
      ) {
        const all: MarketplaceRelease[] = []
        // Fetch every page so old approved versions cannot hide newer ones.
        for (let offset = 0; ; offset += 500) {
          const rows = checked(
            await anon
              .from('marketplace_releases')
              .select(SELECT)
              .eq('status', 'approved')
              .order('id')
              .range(offset, offset + 499),
          ) as MarketplaceRelease[]
          all.push(...rows)
          if (rows.length < 500) break
        }
        const latest = new Map<string, MarketplaceRelease>()
        for (const row of all)
          if (
            !latest.has(row.plugin_id) ||
            compareSemver(row.version, latest.get(row.plugin_id)!.version) > 0
          )
            latest.set(row.plugin_id, row)
        const rows = [...latest.values()].sort((a, b) =>
          a.manifest.name.localeCompare(b.manifest.name),
        )
        // The namespace is verified ownership; manifest.author is arbitrary text.
        if (path === '/index.json')
          return json({
            format: 'bandal-plugin-catalog',
            version: 1,
            name: 'Bandal Marketplace',
            entries: rows.map((r) => ({
              id: r.plugin_id,
              kind: 'extension',
              name: r.manifest.name,
              publisher: r.plugin_id.split('.')[0],
              description: r.manifest.description,
              tags: [],
              version: r.version,
              minAppVersion: r.manifest.minAppVersion,
              url: `${config.publicUrl}/releases/${r.id}/download`,
              sha256: r.sha256,
            })),
          })
        const query = (url.searchParams.get('q') ?? '')
          .slice(0, 200)
          .toLocaleLowerCase()
        const filtered = rows.filter((r) =>
          `${r.manifest.name} ${r.manifest.description} ${r.plugin_id}`
            .toLocaleLowerCase()
            .includes(query),
        )
        const page = Math.max(
          0,
          Math.floor(Number(url.searchParams.get('page')) || 0),
        )
        return json({
          releases: filtered.slice(page * 30, (page + 1) * 30),
          total: filtered.length,
        })
      }
      const download =
        /^\/releases\/([0-9a-f-]{36})\/(download|review-bundle)$/.exec(path)
      if (request.method === 'GET' && download) {
        const client =
          download[2] === 'download' ? anon : (await identity(request)).client
        let query = client
          .from('marketplace_releases')
          .select('artifact_path,sha256')
          .eq('id', download[1]!)
        if (download[2] === 'download') query = query.eq('status', 'approved')
        const row = checked(await query.maybeSingle())
        if (!row) throw new HttpError(404, 'Release unavailable')
        const blob = checked(
          await admin.storage.from(BUCKET).download(row.artifact_path),
        )
        if (!blob) throw new HttpError(404, 'Artifact unavailable')
        const bytes = Buffer.from(await blob.arrayBuffer())
        if (createHash('sha256').update(bytes).digest('hex') !== row.sha256)
          throw new HttpError(502, 'Artifact integrity check failed')
        return new Response(bytes, {
          headers: {
            'content-type': 'application/zip',
            'cache-control': 'no-store',
            'content-disposition': 'attachment; filename="plugin.zip"',
            'x-content-type-options': 'nosniff',
          },
        })
      }
      const publicRelease = /^\/releases\/([0-9a-f-]{36})$/.exec(path)
      if (request.method === 'GET' && publicRelease) {
        // Only previously public releases may be exposed after withdrawal.
        const release = checked(
          await admin
            .from('marketplace_releases')
            .select(SELECT)
            .eq('id', publicRelease[1]!)
            .in('status', ['approved', 'withdrawn'])
            .maybeSingle(),
        )
        if (!release) throw new HttpError(404, 'Release unavailable')
        return json(release)
      }
      const { userId, client } = await identity(request)
      if (request.method === 'GET' && path === '/dashboard') {
        const publisher = checked(
          await client
            .from('marketplace_publishers')
            .select('id,display_name')
            .eq('user_id', userId)
            .maybeSingle(),
        )
        const reviewer =
          checked(await client.rpc('marketplace_is_reviewer')) === true
        let query = client
          .from('marketplace_releases')
          .select(`${SELECT},marketplace_plugins!inner(publisher_id)`)
          .order('created_at', { ascending: false })
          .limit(100)
        if (!reviewer && publisher)
          query = query.eq('marketplace_plugins.publisher_id', publisher.id)
        const releases = reviewer || publisher ? checked(await query) : []
        const reports = reviewer
          ? checked(
              await client
                .from('marketplace_reports')
                .select('*')
                .is('resolved_at', null)
                .order('created_at', { ascending: false })
                .limit(100),
            )
          : []
        return json({
          configured: true,
          signedIn: true,
          publisher,
          reviewer,
          releases,
          reports,
        })
      }
      const body = await readBody(request)
      if (request.method === 'POST' && path === '/publishers') {
        const id = text(body['id'], 63)
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
          throw new HttpError(400, 'Invalid publisher id')
        return json(
          checked(
            await client
              .from('marketplace_publishers')
              .insert({
                id,
                user_id: userId,
                display_name: text(body['displayName'], 80),
              })
              .select('id,display_name')
              .single(),
          ),
          201,
        )
      }
      if (request.method === 'POST' && path === '/releases') {
        const publisher = checked(
          await client
            .from('marketplace_publishers')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle(),
        )
        if (!publisher)
          throw new HttpError(403, 'Register as a developer first')
        const encoded = text(body['artifactBase64'], 12 * 1024 * 1024)
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
          throw new HttpError(400, 'Invalid archive encoding')
        const bytes = Buffer.from(encoded, 'base64')
        const { manifest } = await inspectPluginArchive(bytes)
        if (!manifest.id.startsWith(`${publisher.id}.`))
          throw new HttpError(
            403,
            'Plugin id must use your publisher namespace',
          )
        const changelog =
          body['changelog'] === '' ? '' : text(body['changelog'], 10000)
        const hash = createHash('sha256').update(bytes).digest('hex')
        const artifactPath = `${userId}/${randomUUID()}.zip`
        checked(
          await admin.storage
            .from(BUCKET)
            .upload(artifactPath, bytes, {
              contentType: 'application/zip',
              upsert: false,
            }),
        )
        try {
          const release = checked(
            await admin.rpc('marketplace_submit_release', {
              actor: userId,
              manifest_input: manifest,
              hash_input: hash,
              path_input: artifactPath,
              bytes_input: bytes.length,
              changelog_input: changelog,
            }),
          )
          return json(release, 201)
        } catch (error) {
          await admin.storage.from(BUCKET).remove([artifactPath])
          throw error
        }
      }
      const review = /^\/releases\/([0-9a-f-]{36})\/review$/.exec(path)
      if (request.method === 'POST' && review)
        return json(
          checked(
            await client.rpc('marketplace_review_release', {
              release_id_input: review[1],
              decision: text(body['decision'], 20),
              reason_input: text(body['reason'], 2000),
            }),
          ),
        )
      if (request.method === 'POST' && path === '/reports')
        return json(
          checked(
            await client
              .from('marketplace_reports')
              .insert({
                release_id: text(body['releaseId'], 36),
                user_id: userId,
                reason: text(body['reason'], 2000),
              })
              .select('id')
              .single(),
          ),
          201,
        )
      const resolveReport = /^\/reports\/([0-9a-f-]{36})\/resolve$/.exec(path)
      if (request.method === 'POST' && resolveReport) {
        checked(
          await client.rpc('marketplace_resolve_report', {
            report_id_input: resolveReport[1],
            reason_input: text(body['reason'], 2000),
          }),
        )
        return json({ ok: true })
      }
      throw new HttpError(404, 'Unknown endpoint')
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : 'Request failed' },
        error instanceof HttpError ? error.status : 400,
      )
    }
  }
}
