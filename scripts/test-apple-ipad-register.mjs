import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { main, registerAppleIPad, registrationSummary } from './apple-ipad-register.mjs'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const env = {
  APPLE_API_KEY_P8: privateKey.export({ format: 'pem', type: 'pkcs8' }),
  APPLE_API_KEY_ID: 'TEST_SECRET_KEY_ID',
  APPLE_API_ISSUER: '11111111-2222-4333-8444-555555555555',
  APPLE_TEAM_ID: 'VUZ7Z98BW3'
}
const bundle = { type: 'bundleIds', id: 'PRIVATE_BUNDLE_ID', attributes: { identifier: 'app.bandal.ipad', name: 'Bandal iPad', platform: 'IOS', seedId: 'VUZ7Z98BW3' } }
const capability = { type: 'bundleIdCapabilities', id: 'PRIVATE_CAPABILITY_ID', attributes: { capabilityType: 'APPLE_ID_AUTH', settings: [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT', enabled: true }] }] } }
const now = () => 1_800_000_000_000
const response = (data, status = 200, extra = {}) => new Response(JSON.stringify({ data, ...extra }), { status, headers: { 'Content-Type': 'application/json' } })

function transport(steps) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, options) => {
      const next = steps[calls.length]
      calls.push({ url: new URL(url), ...options })
      assert.ok(next, 'Unexpected extra request')
      return typeof next === 'function' ? next(url, options) : next
    }
  }
}
const creationSteps = () => [response([]), response(bundle, 201), response([bundle]), response([]), response(capability, 201), response([capability])]

test('creates only the fixed bundle and primary Apple capability, verifying each with a GET', async () => {
  const wire = transport(creationSteps())
  const report = await registerAppleIPad({ env, now, ...wire })
  assert.equal(report.outcome, 'complete')
  assert.equal(report.teamConfiguration, 'matched')
  assert.deepEqual(report.bundleId, { status: 'created_verified', write: 'accepted' })
  assert.deepEqual(report.signInWithApple, { status: 'created_verified', write: 'accepted' })
  assert.equal(report.limitations.issuerTeamIndependentlyVerified, false)
  assert.deepEqual(wire.calls.map(call => `${call.method} ${call.url.pathname}`), [
    'GET /v1/bundleIds', 'POST /v1/bundleIds', 'GET /v1/bundleIds',
    'GET /v1/bundleIds/PRIVATE_BUNDLE_ID/bundleIdCapabilities',
    'POST /v1/bundleIdCapabilities', 'GET /v1/bundleIds/PRIVATE_BUNDLE_ID/bundleIdCapabilities'
  ])
  assert.deepEqual(JSON.parse(wire.calls[1].body), { data: { type: 'bundleIds', attributes: bundle.attributes } })
  assert.deepEqual(JSON.parse(wire.calls[4].body), { data: { type: 'bundleIdCapabilities', attributes: capability.attributes, relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } } } })
  for (const call of wire.calls) {
    assert.equal(call.url.origin, 'https://api.appstoreconnect.apple.com')
    assert.equal(call.redirect, 'error')
    assert.equal(call.credentials, 'omit')
    assert.ok(call.signal instanceof AbortSignal)
    assert.equal(call.headers.Cookie, undefined)
    const parts = call.headers.Authorization.slice('Bearer '.length).split('.')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'))
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url'))
    assert.deepEqual(header, { alg: 'ES256', kid: env.APPLE_API_KEY_ID, typ: 'JWT' })
    assert.equal(payload.iss, env.APPLE_API_ISSUER)
    assert.equal(payload.aud, 'appstoreconnect-v1')
    assert.equal(payload.iat, now() / 1000)
    assert.equal(payload.exp - payload.iat, 120)
    assert.ok(verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')))
    if (call.method === 'GET') {
      assert.deepEqual(payload.scope, [`GET ${call.url.pathname}${call.url.search}`])
      assert.equal(call.body, undefined)
    } else {
      assert.equal(payload.scope, undefined, 'Apple documents scope for GET only')
      assert.equal(call.url.search, '')
    }
  }
  assert.equal(wire.calls[0].url.searchParams.get('filter[identifier]'), 'app.bandal.ipad')
  assert.equal(wire.calls[0].url.searchParams.get('fields[bundleIds]'), 'identifier,name,platform,seedId')
  assert.equal(wire.calls[3].url.search, '')
  assert.equal(wire.calls[5].url.search, '')
})

test('reuses the exact registration without writes and can resume after a previous partial run', async () => {
  const existing = transport([response([bundle]), response([capability])])
  const report = await registerAppleIPad({ env, now, ...existing })
  assert.equal(report.outcome, 'complete')
  assert.equal(report.bundleId.status, 'reused_verified')
  assert.equal(report.signInWithApple.status, 'reused_verified')
  assert.ok(existing.calls.every(call => call.method === 'GET'))
  const partial = transport([response([bundle]), response([]), response(capability, 201), response([capability])])
  assert.equal((await registerAppleIPad({ env, now, ...partial })).outcome, 'complete')
  assert.deepEqual(partial.calls.filter(call => call.method === 'POST').map(call => call.url.pathname), ['/v1/bundleIdCapabilities'])
})

test('accepts Apple-normalized UNIVERSAL bundles for iOS but rejects macOS-only bundles', async () => {
  const normalized = { ...bundle, attributes: { ...bundle.attributes, platform: 'UNIVERSAL' } }
  const created = transport([response([]), response(normalized, 201), response([normalized]), response([]), response(capability, 201), response([capability])])
  assert.equal((await registerAppleIPad({ env, now, ...created })).outcome, 'complete')
  assert.equal(JSON.parse(created.calls[1].body).data.attributes.platform, 'IOS')
  const existing = transport([response([normalized]), response([capability])])
  assert.equal((await registerAppleIPad({ env, now, ...existing })).outcome, 'complete')
  assert.ok(existing.calls.every(call => call.method === 'GET'))
  const wrong = transport([response([{ ...bundle, attributes: { ...bundle.attributes, platform: 'MAC_OS' } }])])
  const report = await registerAppleIPad({ env, now, ...wrong })
  assert.equal(report.reason, 'bundle_attributes_mismatch')
  assert.equal(report.bundleId.validation.returnedPlatform, 'MAC_OS')
  assert.equal(wrong.calls.length, 1)
})

test('missing, mismatched-team and invalid credentials stop before any request without exposing their values', async () => {
  for (const [changes, reason] of [
    [{ APPLE_TEAM_ID: '' }, 'missing_credentials'],
    [{ APPLE_TEAM_ID: 'WRONG_TEAM_SECRET' }, 'team_configuration_mismatch'],
    [{ APPLE_API_KEY_P8: 'INVALID_PRIVATE_SECRET' }, 'invalid_credentials'],
    [{ APPLE_API_KEY_ID: 'unsafe/path' }, 'invalid_credentials'],
    [{ APPLE_API_ISSUER: 'INVALID_ISSUER_SECRET' }, 'invalid_credentials']
  ]) {
    const wire = transport([])
    const report = await registerAppleIPad({ env: { ...env, ...changes }, ...wire })
    assert.equal(report.outcome, 'blocked')
    assert.equal(report.reason, reason)
    assert.equal(wire.calls.length, 0)
    for (const value of Object.values(changes).filter(Boolean)) assert.ok(!JSON.stringify(report).includes(value))
  }
})

test('wrong existing attributes, duplicate identifiers, unsafe IDs and incomplete listings never trigger creation', async () => {
  const variants = Object.entries({ identifier: 'other.app', name: 'Other name', platform: 'UNRECOGNIZED', seedId: 'WRONG_TEAM' })
    .map(([key, value]) => response([{ ...bundle, attributes: { ...bundle.attributes, [key]: value } }]))
  variants.push(response([bundle, bundle]), response([{ ...bundle, id: '../other' }]), response([],
    200, { links: { next: 'https://attacker.invalid/?token=PRIVATE' } }), response([], 200, { links: { next: '/v1/bundleIds?cursor=more' } }))
  for (const first of variants) {
    const wire = transport([first])
    assert.equal((await registerAppleIPad({ env, now, ...wire })).outcome, 'blocked')
    assert.equal(wire.calls.length, 1)
    assert.equal(wire.calls[0].method, 'GET')
  }
})

test('403, authentication errors, conflicts, redirects and rate limits stop immediately with no retry or raw-body output', async () => {
  for (const [status, reason] of [[401, 'authentication_failed'], [403, 'forbidden'], [409, 'conflict'], [302, 'http_error'], [429, 'rate_limited'], [500, 'http_error']]) {
    const wire = transport([response([]), new Response('SECRET_RAW_ERROR', { status, headers: { Location: 'https://attacker.invalid/' } })])
    const report = await registerAppleIPad({ env, now, ...wire })
    assert.equal(report.reason, reason)
    assert.equal(report.outcome, 'blocked')
    assert.equal(wire.calls.length, 2)
    assert.ok(!JSON.stringify(report).includes('SECRET_RAW_ERROR'))
    assert.equal(report.authentication, status === 401 ? 'rejected' : 'accepted')
  }
  const wire = transport([response([bundle]), response([]), new Response('SECRET_ROLE_ERROR', { status: 403 })])
  const report = await registerAppleIPad({ env, now, ...wire })
  assert.equal(report.reason, 'forbidden')
  assert.equal(report.bundleId.status, 'reused_verified')
  assert.equal(wire.calls.length, 3)
})

test('unknown write outcomes are not retried and GET verification is required before enabling a capability', async () => {
  for (const result of [() => { throw new Error('SECRET_FETCH_ERROR') }, new Response('{invalid', { status: 201 })]) {
    const wire = transport([response([]), result])
    const report = await registerAppleIPad({ env, now, ...wire })
    assert.equal(report.reason, 'write_outcome_unknown')
    assert.equal(report.bundleId.status, 'unverified_after_write')
    assert.equal(wire.calls.length, 2)
  }
  for (const verification of [response([]), response([{ ...bundle, id: 'OTHER' }]), response([{ ...bundle, attributes: { ...bundle.attributes, seedId: 'OTHER' } }])]) {
    const wire = transport([response([]), response(bundle, 201), verification])
    const report = await registerAppleIPad({ env, now, ...wire })
    assert.equal(report.reason, 'bundle_verification_failed')
    assert.equal(wire.calls.length, 3)
  }
})

test('existing Sign in with Apple settings must match primary configuration; no PATCH or regrouping occurs', async () => {
  for (const settings of [undefined, null, 'invalid', [], [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT', enabled: false }] }]]) {
    const wire = transport([response([bundle]), response([{ ...capability, attributes: { ...capability.attributes, settings } }])])
    assert.equal((await registerAppleIPad({ env, now, ...wire })).reason, 'existing_sign_in_configuration_mismatch')
    assert.ok(wire.calls.every(call => call.method === 'GET'))
  }
  for (const caps of [[capability, capability], [{ ...capability, attributes: {} }]]) {
    const wire = transport([response([bundle]), response(caps)])
    assert.equal((await registerAppleIPad({ env, now, ...wire })).outcome, 'blocked')
    assert.equal(wire.calls.length, 2)
  }
})

test('the newly enabled capability must be present and primary in a subsequent GET', async () => {
  for (const caps of [[], [{ ...capability, id: 'OTHER' }], [{ ...capability, attributes: { ...capability.attributes, settings: [] } }]]) {
    const wire = transport([response([bundle]), response([]), response(capability, 201), response(caps)])
    const report = await registerAppleIPad({ env, now, ...wire })
    assert.equal(report.reason, 'capability_verification_failed')
    assert.equal(report.signInWithApple.write, 'accepted')
    assert.equal(report.signInWithApple.status, 'unverified_after_write')
    assert.equal(wire.calls.length, 4)
  }
})

test('sanitized JSON, summaries and exceptions never expose credentials, token headers, raw bodies or remote IDs', async () => {
  const wire = transport(creationSteps())
  const output = [], summaries = []
  assert.equal(await main({ env, ...wire, write: text => output.push(text), summary: async text => { summaries.push(text) } }), 0)
  const combined = output.join('') + summaries.join('')
  for (const secret of [env.APPLE_API_KEY_P8, env.APPLE_API_KEY_ID, env.APPLE_API_ISSUER, env.APPLE_TEAM_ID, bundle.id, capability.id, ...wire.calls.map(call => call.headers.Authorization)]) assert.ok(!combined.includes(secret))
  const failed = [], failedSummaries = []
  assert.equal(await main({ env, fetchImpl: async () => { throw new Error('SECRET_EXCEPTION') }, write: text => failed.push(text), summary: async text => { failedSummaries.push(text) } }), 1)
  assert.ok(!failed.join('').includes('SECRET_EXCEPTION'))
  assert.ok(registrationSummary(JSON.parse(output[0])).includes('Create the app record'))
})

test('oversized or malformed successful response bodies cannot authorize a write', async () => {
  for (const result of [new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }), new Response('not JSON', { status: 200 }), response(null)]) {
    const wire = transport([result])
    assert.equal((await registerAppleIPad({ env, now, ...wire })).outcome, 'blocked')
    assert.equal(wire.calls.length, 1)
  }
})

test('manual main-only workflow has no configurable target and exposes secrets only to the registration process', () => {
  const workflow = readFileSync(new URL('../.github/workflows/apple-ipad-register.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.ok(!/inputs:|pull_request|schedule:|upload-artifact|contents: write/.test(workflow))
  const secretBoundary = workflow.indexOf('APPLE_API_KEY_P8:')
  assert.ok(secretBoundary > workflow.indexOf('node --test scripts/test-apple-ipad-register.mjs'))
  assert.equal(workflow.match(/\$\{\{ secrets\./g).length, 4)
  assert.match(workflow.slice(secretBoundary), /run: node scripts\/apple-ipad-register\.mjs/)
})
