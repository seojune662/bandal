import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { createMarketplaceService } from '../../server/marketplace/service'

const directory = process.env['BANDAL_MARKETPLACE_TEST_DIR']
describe.skipIf(!directory)(
  'marketplace with real local Auth, RLS and Storage',
  () => {
    let admin: SupabaseClient
    let service: (request: Request) => Promise<Response>
    const users: Array<{ id: string; token: string; client: SupabaseClient }> =
      []
    let releaseId: string
    let archive: string
    beforeAll(async () => {
      const config = JSON.parse(
        execFileSync(
          'supabase',
          ['status', '--workdir', directory!, '-o', 'json'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      ) as Record<string, string>
      const url = config['API_URL']!
      const key = config['ANON_KEY']!
      const serviceKey = config['SERVICE_ROLE_KEY']!
      admin = createClient(url, serviceKey, { auth: { persistSession: false } })
      service = createMarketplaceService({
        supabaseUrl: url,
        publishableKey: key,
        serviceRoleKey: serviceKey,
        publicUrl: 'https://marketplace.example.com',
      })
      for (let i = 0; i < 3; i++) {
        const email = `marketplace-${randomUUID()}@example.com`
        const password = `Bandal-${randomUUID()}`
        const created = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })
        if (created.error) throw created.error
        const client = createClient(url, key, {
          auth: { persistSession: false },
        })
        const signed = await client.auth.signInWithPassword({ email, password })
        if (signed.error || !signed.data.session) throw signed.error
        users.push({
          id: created.data.user!.id,
          token: signed.data.session.access_token,
          client,
        })
      }
      const reviewer = await admin
        .from('marketplace_reviewers')
        .insert({ user_id: users[2]!.id })
      if (reviewer.error) throw reviewer.error
      archive = await new JSZip()
        .file(
          'manifest.json',
          JSON.stringify({
            manifestVersion: 2,
            id: 'alice.study',
            name: 'Study helper',
            version: '1.0.0',
            minAppVersion: '0.41.2',
            author: 'Alice',
            description: 'Test plugin',
            permissions: ['commands'],
            contributes: { commands: [{ id: 'hello', title: 'Hello' }] },
          }),
        )
        .file(
          'main.js',
          "module.exports = { activate(bandal) { bandal.commands.register('hello', () => {}); } }",
        )
        .generateAsync({ type: 'base64' })
    }, 60_000)
    const call = (path: string, actor?: number, body?: unknown) =>
      service(
        new Request(`https://marketplace.example.com${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers:
            actor === undefined
              ? {}
              : { Authorization: `Bearer ${users[actor]!.token}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      )
    test('requires an authenticated publisher, and prevents cross-user registration', async () => {
      expect((await call('/dashboard')).status).toBe(401)
      expect(
        (
          await call('/publishers', 0, {
            id: 'bandal',
            displayName: 'Impersonator',
          })
        ).status,
      ).toBe(400)
      expect(
        (await call('/publishers', 0, { id: 'alice', displayName: 'Alice' }))
          .status,
      ).toBe(201)
      expect(
        (await call('/publishers', 1, { id: 'bob', displayName: 'Bob' }))
          .status,
      ).toBe(201)
      const attempt = await users[1]!.client
        .from('marketplace_publishers')
        .insert({ id: 'stolen', user_id: users[0]!.id, display_name: 'Stolen' })
      expect(attempt.error).not.toBeNull()
    })
    test('server validates archives, ownership and immutable versions', async () => {
      expect(
        (
          await call('/releases', 0, {
            artifactBase64: 'bm90IGEgemlw',
            changelog: '',
          })
        ).status,
      ).toBe(400)
      expect(
        (await call('/releases', 1, { artifactBase64: archive, changelog: '' }))
          .status,
      ).toBe(403)
      const response = await call('/releases', 0, {
        artifactBase64: archive,
        changelog: 'First release',
      })
      const created = await response.json()
      expect(response.status, JSON.stringify(created)).toBe(201)
      releaseId = created.id
      expect(typeof releaseId).toBe('string')
      expect(
        (
          await call('/releases', 0, {
            artifactBase64: archive,
            changelog: 'Overwrite',
          })
        ).status,
      ).toBe(400)
    })
    test('pending bytes are private and only their owner and reviewers can inspect them', async () => {
      expect((await call(`/releases/${releaseId}`)).status).toBe(404)
      expect((await (await call('/index.json')).json()).entries).toEqual([])
      expect((await call(`/releases/${releaseId}/download`)).status).toBe(404)
      expect(
        (await call(`/releases/${releaseId}/review-bundle`, 1)).status,
      ).toBe(404)
      expect(
        (await call(`/releases/${releaseId}/review-bundle`, 0)).status,
      ).toBe(200)
      const forged = await users[0]!.client.rpc('marketplace_review_release', {
        release_id_input: releaseId,
        decision: 'approved',
        reason_input: 'Forged',
      })
      expect(forged.error).not.toBeNull()
      const bypass = await users[0]!.client
        .from('marketplace_releases')
        .update({ status: 'approved' })
        .eq('id', releaseId)
      expect(bypass.error).not.toBeNull()
    })
    test('review publishes a verified artifact and permits reporting', async () => {
      expect(
        (
          await call(`/releases/${releaseId}/review`, 2, {
            decision: 'approved',
            reason: 'Source reviewed',
          })
        ).status,
      ).toBe(200)
      expect((await (await call('/index.json')).json()).entries).toMatchObject([
        { publisher: 'alice' },
      ])
      const download = await call(`/releases/${releaseId}/download`)
      expect(Buffer.from(await download.arrayBuffer()).toString('base64')).toBe(
        archive,
      )
      expect(
        (
          await call('/reports', 1, {
            releaseId,
            reason: 'Please review the network permission',
          })
        ).status,
      ).toBe(201)
    })
    test('withdrawal immediately blocks downloads and leaves the audit trail', async () => {
      expect(
        (
          await call(`/releases/${releaseId}/review`, 2, {
            decision: 'withdrawn',
            reason: 'Withdrawn for a test',
          })
        ).status,
      ).toBe(200)
      expect((await call(`/releases/${releaseId}/download`)).status).toBe(404)
      expect((await (await call('/index.json')).json()).entries).toEqual([])
      expect((await (await call(`/releases/${releaseId}`)).json()).status).toBe(
        'withdrawn',
      )
      const audit = await admin
        .from('marketplace_audit')
        .select('action')
        .eq('release_id', releaseId)
        .order('id')
      expect(audit.data?.map((row) => row.action)).toEqual([
        'submitted',
        'approved',
        'withdrawn',
      ])
    })
    test('only reviewers resolve reports, preserving a reason in the audit trail', async () => {
      const dashboard = await (await call('/dashboard', 2)).json()
      expect(dashboard.reports).toHaveLength(1)
      const id = dashboard.reports[0].id
      expect(
        (await call(`/reports/${id}/resolve`, 0, { reason: 'Forged' })).status,
      ).toBe(400)
      expect(
        (
          await call(`/reports/${id}/resolve`, 2, {
            reason: 'Withdrawn release reviewed',
          })
        ).status,
      ).toBe(200)
      expect((await (await call('/dashboard', 2)).json()).reports).toEqual([])
      const audit = await admin
        .from('marketplace_audit')
        .select('action,reason')
        .eq('release_id', releaseId)
        .order('id', { ascending: false })
        .limit(1)
      expect(audit.data?.[0]).toMatchObject({
        action: 'report_resolved',
        reason: `${id}: Withdrawn release reviewed`,
      })
    })
  },
)
