import { createRequire } from 'node:module'
import { planChecks } from './affected-checks.mjs'
const require = createRequire(import.meta.url)
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { descriptor, claimsFor, validateIdentity, authenticate, childEnvironment, verifyArtifact, safeStatus } = require('./verify-windows-cloud-sync.cjs')
const runID = '11111111-1111-4111-8111-111111111111', userID = '22222222-2222-4222-8222-222222222222'
const manifest = () => ({ runID, userID, courseID: '33333333-3333-4333-8333-333333333333', desktopInkID: '44444444-4444-4444-8444-444444444444', projectURL: 'https://ukacrkcwiqafwpppshxb.supabase.co', pdfSHA: 'a'.repeat(64), notePath: 'roundtrip.md', pdfPath: 'roundtrip.pdf', expectedDesktopMarkdown: 'Mac → iPad ' + runID, expectedNativeMarkdown: 'iPad → Mac ' + runID, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })
const identity = () => ({ id: userID, email: `bandal-qa-${runID}@example.invalid`, user_metadata: { validationRun: runID, purpose: 'Bandal isolated sync validation' } })
const jwt = overrides => 'eyJhbGciOiJFUzI1NiJ9.' + Buffer.from(JSON.stringify({ role: 'authenticated', aud: 'authenticated', sub: userID, iss: manifest().projectURL + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 1800, ...overrides })).toString('base64url') + '.not-a-real-signature'
const status = () => ({ scope: 'personal-content-v1', access: { writeAllowed: true, accessSource: 'beta' }, pending: 0, deferred: 0, conflicts: 0, projectionPending: false })

test('manual QA workflow and driver select boundary tests and only the startup fallback', () => {
  for (const file of ['.github/workflows/verify-windows-cloud-sync.yml', 'scripts/verify-windows-cloud-sync.cjs']) {
    const plan = planChecks([file])
    assert.ok(plan.scriptTests.includes('scripts/test-windows-cloud-sync.mjs'))
    assert.equal(plan.full, false); assert.deepEqual(plan.e2e, ['e2e/startup.spec.ts'])
  }
})

test('accepts only the exact non-secret, temporary QA seed contract', () => {
  const m = manifest(); assert.deepEqual(descriptor(JSON.stringify(m)), m)
  for (const value of [{ ...m, session: {} }, { ...m, refresh_token: 'forbidden' }, { ...m, projectURL: 'https://other.supabase.co' }, { ...m, notePath: '../another.md' }, { ...m, expectedNativeMarkdown: 'ordinary user text' }, { ...m, expiresAt: new Date(Date.now() + 120 * 60_000).toISOString() }]) {
    assert.throws(() => descriptor(JSON.stringify(value)), /^Error: qa_/)
  }
})

test('rejects administrator, unrelated, expired, and excessive-life tokens before transport', () => {
  assert.equal(claimsFor(jwt(), manifest()).sub, userID)
  for (const change of [{ role: 'service_role' }, { aud: 'service_role' }, { sub: runID }, { iss: 'https://other.supabase.co/auth/v1' }, { exp: 1 }, { exp: Math.floor(Date.now() / 1000) + 7200 }]) {
    assert.throws(() => claimsFor(jwt(change), manifest()), /^Error: qa_access_token_/)
  }
  assert.throws(() => claimsFor('sb_secret_fake', manifest()))
  assert.throws(() => claimsFor('bad.'.padEnd(120, 'x') + '.signature', manifest()), /qa_access_token_format/)
})

test('requires the exact synthetic identity and both validation metadata markers', () => {
  validateIdentity(identity(), manifest())
  for (const value of [{ ...identity(), id: runID }, { ...identity(), email: 'someone@example.invalid' }, { ...identity(), user_metadata: { validationRun: runID } }, { ...identity(), user_metadata: { ...identity().user_metadata, validationRun: userID } }]) {
    assert.throws(() => validateIdentity(value, manifest()), /qa_identity_mismatch/)
  }
})

test('verifies the actual server identity and paid beta gate before allowing work', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => url.endsWith('/user') ? identity() : { writeAllowed: true, accessSource: 'beta', enforcePaidAccess: true, storageLimitBytes: 5368709120 } }
  })
  const env = { BANDAL_CLOUD_QA_ACCESS_TOKEN: jwt(), BANDAL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'a'.repeat(40) }
  const result = await authenticate(manifest(), env)
  assert.equal(result.token, env.BANDAL_CLOUD_QA_ACCESS_TOKEN)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.options.redirect === 'error' && call.url.startsWith(manifest().projectURL + '/')))
})

test('a forged JWT claim alone never permits cloud work and a paid subscription is not a QA grant', async t => {
  const env = { BANDAL_CLOUD_QA_ACCESS_TOKEN: jwt(), BANDAL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'a'.repeat(40) }
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ ...identity(), id: runID }) }))
  await assert.rejects(authenticate(manifest(), env), /qa_identity_mismatch/)
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async url => ({ ok: true, json: async () => url.endsWith('/user') ? identity() : { writeAllowed: true, accessSource: 'subscription', enforcePaidAccess: true, storageLimitBytes: 5368709120 } }))
  await assert.rejects(authenticate(manifest(), env), /qa_beta_access_required/)
})

test('private and administrator API keys are rejected without sending a request', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not fetch') })
  for (const key of ['sb_secret_' + 'a'.repeat(40), jwt({ role: 'service_role', ref: 'ukacrkcwiqafwpppshxb' }), jwt({ role: 'anon', ref: 'anotherproject' })]) {
    await assert.rejects(authenticate(manifest(), { BANDAL_CLOUD_QA_ACCESS_TOKEN: jwt(), BANDAL_SUPABASE_PUBLISHABLE_KEY: key }), /qa_public_key_/)
  }
  assert.equal(calls, 0)
})

test('child processes receive only platform essentials and explicitly scoped QA credentials', () => {
  const env = childEnvironment({ Path: 'bin', SystemRoot: 'C:\\Windows', TEMP: 'temp', GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', SERVICE_ROLE: 'secret', REFRESH_TOKEN: 'secret', HTTPS_PROXY: 'proxy', BANDAL_CLOUD_QA_ACCESS_TOKEN: 'secret' }, { BANDAL_ACCESS_TOKEN: 'scoped' })
  assert.deepEqual(env, { Path: 'bin', SystemRoot: 'C:\\Windows', TEMP: 'temp', BANDAL_ACCESS_TOKEN: 'scoped' })
})

test('companion execution is denied if either its binary or checked-out source differs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bandal-companion-hash-'))
  try {
    const dir = path.join(root, 'resources/native/ipad-bridge/win32-x64'), source = path.join(root, 'resources/ipad-bridge')
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(source, { recursive: true })
    const sha = data => crypto.createHash('sha256').update(data).digest('hex')
    fs.writeFileSync(path.join(source, 'bridge.py'), 'source')
    fs.writeFileSync(path.join(dir, 'bandal-ipad-bridge.exe'), 'binary')
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ platform: 'win32', arch: 'x64', sourceHash: sha('source'), binaryHash: sha('binary') }))
    assert.equal(verifyArtifact(root).sourceHash, sha('source'))
    fs.writeFileSync(path.join(dir, 'bandal-ipad-bridge.exe'), 'changed')
    assert.throws(() => verifyArtifact(root), /qa_companion_binary_mismatch/)
    fs.writeFileSync(path.join(dir, 'bandal-ipad-bridge.exe'), 'binary')
    fs.writeFileSync(path.join(source, 'bridge.py'), 'changed')
    assert.throws(() => verifyArtifact(root), /qa_companion_source_mismatch/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('evidence is never declared complete while pending work, conflicts, or projection remain', () => {
  assert.equal(safeStatus(status()).conflicts, 0)
  for (const value of [{ ...status(), pending: 1 }, { ...status(), deferred: 1 }, { ...status(), conflicts: 1 }, { ...status(), projectionPending: true }, { ...status(), access: { writeAllowed: false, accessSource: 'none' } }]) {
    assert.throws(() => safeStatus(value), /^Error: qa_/)
  }
})
