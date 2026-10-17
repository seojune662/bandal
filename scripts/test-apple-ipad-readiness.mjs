import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { inspectAppleReadiness, main, readinessSummary } from './apple-ipad-readiness.mjs'

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const env = {
  APPLE_API_KEY_P8: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  APPLE_API_KEY_ID: 'TESTKEY123',
  APPLE_API_ISSUER: '12345678-1234-1234-1234-123456789abc'
}
const sentinel = 'PRIVATE_TEST_VALUE_MUST_NOT_APPEAR'
const target = 'app.bandal.ipad'
const row = (type, id, attributes) => ({ type, id, attributes })
const response = (data, next = null) => new Response(JSON.stringify({ data, links: { next } }), { status: 200 })
function fixture(url) {
  switch (new URL(url).pathname) {
    case '/v1/apps': return response([row('apps', '1234567', { bundleId: target, name: sentinel, subscriptionStatusUrl: `https://private.invalid/${sentinel}`, subscriptionStatusUrlVersion: 'V2', subscriptionStatusUrlForSandbox: null, subscriptionStatusUrlVersionForSandbox: null })])
    case '/v1/bundleIds': return response([row('bundleIds', 'BUNDLE123', { identifier: target, platform: 'IOS' })])
    case '/v1/bundleIds/BUNDLE123/bundleIdCapabilities': return response([row('bundleIdCapabilities', 'cap1', { capabilityType: 'IN_APP_PURCHASE' }), row('bundleIdCapabilities', 'cap2', { capabilityType: 'APPLE_ID_AUTH' })])
    case '/v1/apps/1234567/subscriptionGroups': return response([row('subscriptionGroups', '8765432', { referenceName: sentinel })])
    case '/v1/subscriptionGroups/8765432/subscriptions': return response([
      row('subscriptions', '7654321', { productId: `${target}.sync.monthly`, state: 'READY_TO_SUBMIT', subscriptionPeriod: 'ONE_MONTH' }),
      row('subscriptions', '7654322', { productId: `${target}.sync.yearly`, state: 'APPROVED', subscriptionPeriod: 'ONE_YEAR' })
    ])
    default: throw new Error(`Unexpected request ${url}`)
  }
}

test('signs verified ES256 tokens with 120-second exact GET scopes and sends only fixed Apple reads', async () => {
  const requests = []
  const tokens = []
  const now = 1_800_000_000_000
  const report = await inspectAppleReadiness({ env, now: () => now, fetchImpl: async (url, options) => {
    requests.push(new URL(url))
    assert.equal(new URL(url).origin, 'https://api.appstoreconnect.apple.com')
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.body, undefined)
    const token = options.headers.Authorization.slice('Bearer '.length)
    tokens.push(token)
    const [header, payload, signature] = token.split('.')
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: env.APPLE_API_KEY_ID, typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(payload, 'base64url'))
    assert.equal(claims.iss, env.APPLE_API_ISSUER)
    assert.equal(claims.aud, 'appstoreconnect-v1')
    assert.equal(claims.iat, now / 1000)
    assert.equal(claims.exp - claims.iat, 120)
    assert.deepEqual(claims.scope, [`GET ${new URL(url).pathname}${new URL(url).search}`])
    assert.equal(verify('sha256', Buffer.from(`${header}.${payload}`), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true)
    return fixture(url)
  } })
  assert.deepEqual(requests.map(url => url.pathname), ['/v1/apps', '/v1/bundleIds', '/v1/bundleIds/BUNDLE123/bundleIdCapabilities', '/v1/apps/1234567/subscriptionGroups', '/v1/subscriptionGroups/8765432/subscriptions'])
  assert.equal(requests[0].searchParams.get('filter[bundleId]'), target)
  assert.equal(requests[1].searchParams.get('filter[identifier]'), target)
  assert.equal(requests[4].searchParams.get('filter[productId]'), `${target}.sync.monthly,${target}.sync.yearly`)
  assert.equal(report.authentication, 'accepted')
  assert.equal(report.app.status, 'present')
  assert.deepEqual(report.app.notifications, { production: 'configured', sandbox: 'missing', productionVersion: 'V2', sandboxVersion: 'unknown' })
  assert.deepEqual(report.subscriptions.map(product => [product.status, product.state, product.period]), [['present', 'READY_TO_SUBMIT', 'ONE_MONTH'], ['present', 'APPROVED', 'ONE_YEAR']])
  assert.equal(report.limitations.writePermission, 'unknown')
  assert.equal(report.limitations.paidAppsAgreement, 'unknown')
  assert.equal(report.limitations.inAppPurchaseServerKey, 'unknown')
  const printed = JSON.stringify(report) + readinessSummary(report)
  for (const forbidden of [sentinel, ...Object.values(env), ...tokens, 'Authorization', '1234567', 'BUNDLE123', '8765432', 'private.invalid']) assert.equal(printed.includes(forbidden), false)
})

test('missing or malformed credentials never cause a request or expose key parser errors', async () => {
  for (const credentials of [{}, { ...env, APPLE_API_KEY_P8: sentinel }, { ...env, APPLE_API_ISSUER: sentinel }]) {
    let output = ''
    const exitCode = await main({ env: credentials, fetchImpl: () => { assert.fail('Must not fetch') }, write: text => { output += text }, summary: async () => {} })
    assert.equal(exitCode, 1)
    assert.equal(JSON.parse(output).authentication, 'unknown')
    assert.equal(output.includes(sentinel), false)
    assert.equal(output.includes('BEGIN PRIVATE KEY'), false)
  }
})

test('401 stops later requests; 403 remains forbidden/unknown while independent reads continue', async () => {
  for (const status of [401, 403]) {
    let calls = 0
    let errorBodyRead = false
    const report = await inspectAppleReadiness({ env, fetchImpl: async () => {
      calls += 1
      return { status, body: { cancel: async () => {} }, json: async () => { errorBodyRead = true; throw new Error(sentinel) } }
    } })
    assert.equal(calls, status === 401 ? 1 : 2)
    assert.equal(errorBodyRead, false)
    assert.equal(report.requests[0].result, status === 401 ? 'authentication_failed' : 'forbidden')
    assert.equal(report.authentication, status === 401 ? 'rejected' : 'unknown')
    assert.equal(report.app.status, 'unknown')
    assert.equal(report.bundleId.status, 'unknown')
    assert.ok(report.subscriptions.every(product => product.status === 'unknown'))
  }
})

test('logs only sanitized results when fetch exceptions echo credentials, URLs or bearer tokens', async () => {
  let output = ''
  let summary = ''
  let leakedToken
  const exitCode = await main({ env, fetchImpl: async (_url, options) => {
    leakedToken = options.headers.Authorization
    throw new Error(`${sentinel} ${env.APPLE_API_KEY_P8} ${leakedToken}`)
  }, write: text => { output += text }, summary: async text => { summary = text } })
  assert.equal(exitCode, 1)
  for (const forbidden of [sentinel, leakedToken, ...Object.values(env), 'Error:', 'stack']) assert.equal((output + summary).includes(forbidden), false)
  assert.equal(JSON.parse(output).requests[0].result, 'transport_error')
})

test('successful empty filtered lists mean missing; malformed JSON and HTTP failures remain unknown', async () => {
  const missing = await inspectAppleReadiness({ env, fetchImpl: async () => response([]) })
  assert.equal(missing.app.status, 'missing')
  assert.equal(missing.bundleId.status, 'missing')
  assert.ok(missing.subscriptions.every(product => product.status === 'missing'))
  for (const reply of [() => new Response(sentinel), () => new Response(sentinel, { status: 429 }), () => new Response(sentinel, { status: 500 })]) {
    const report = await inspectAppleReadiness({ env, fetchImpl: async () => reply() })
    assert.equal(report.app.status, 'unknown')
    assert.equal(JSON.stringify(report).includes(sentinel), false)
  }
})

test('preserves filter and re-scopes pagination; incomplete pagination never declares a product missing', async () => {
  let pages = 0
  const report = await inspectAppleReadiness({ env, fetchImpl: async (url, options) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/subscriptions')) {
      pages += 1
      if (!parsed.searchParams.has('cursor')) {
        parsed.searchParams.set('cursor', 'page-two')
        return response([row('subscriptions', '7654321', { productId: `${target}.sync.monthly`, state: 'READY_TO_SUBMIT', subscriptionPeriod: 'ONE_MONTH' })], parsed.href)
      }
      assert.equal(parsed.searchParams.get('cursor'), 'page-two')
      assert.equal(parsed.searchParams.get('filter[productId]'), `${target}.sync.monthly,${target}.sync.yearly`)
      const claims = JSON.parse(Buffer.from(options.headers.Authorization.split('.')[1], 'base64url'))
      assert.deepEqual(claims.scope, [`GET ${parsed.pathname}${parsed.search}`])
      return new Response('private details', { status: 403 })
    }
    return fixture(url)
  } })
  assert.equal(pages, 2)
  assert.ok(report.subscriptions.every(product => product.status === 'unknown'))
})

test('rejects cross-host, different resource, changed filter and credential-bearing pagination links before requesting', async () => {
  for (const next of [
    'https://attacker.invalid/collect?cursor=x',
    'https://api.appstoreconnect.apple.com/v1/users?cursor=x',
    'https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=other&cursor=x',
    'https://user:password@api.appstoreconnect.apple.com/v1/apps?cursor=x',
    '//attacker.invalid/v1/apps?cursor=x'
  ]) {
    const urls = []
    const report = await inspectAppleReadiness({ env, fetchImpl: async url => {
      urls.push(url)
      if (new URL(url).pathname === '/v1/apps') return response([], next)
      return response([])
    } })
    assert.equal(urls.length, 2)
    assert.ok(urls.every(url => new URL(url).origin === 'https://api.appstoreconnect.apple.com'))
    assert.equal(report.app.status, 'unknown')
    assert.equal(report.requests[1].result, 'invalid_pagination')
    assert.equal(JSON.stringify(report).includes('attacker'), false)
  }
})

test('rejects mismatched app identities and path injection from API resource IDs', async () => {
  for (const [id, identifier] of [['123', 'unrelated.app'], ['../users', target], [`123/${sentinel}`, target]]) {
    const urls = []
    const report = await inspectAppleReadiness({ env, fetchImpl: async url => {
      urls.push(url)
      if (new URL(url).pathname === '/v1/apps') return response([row('apps', id, { bundleId: identifier })])
      return response([])
    } })
    assert.equal(report.app.status, 'unknown')
    assert.equal(urls.length, 2)
    assert.equal(JSON.stringify(report).includes(sentinel), false)
  }
})

test('missing required product/capability attributes cannot become false missing or not_listed results', async () => {
  for (const resource of ['subscriptions', 'bundleIdCapabilities']) {
    const report = await inspectAppleReadiness({ env, fetchImpl: async url => {
      if (new URL(url).pathname.endsWith(`/${resource}`)) return response([row(resource, '123', { name: sentinel })])
      return fixture(url)
    } })
    assert.ok(report.requests.some(request => request.result === 'invalid_response'))
    if (resource === 'subscriptions') assert.ok(report.subscriptions.every(product => product.status === 'unknown'))
    else assert.equal(report.capabilities.inAppPurchase, 'unknown')
  }
})

test('workflow is manual/main-only, read-only, dependency-free and restricts secrets to the probe step', () => {
  const workflow = readFileSync(new URL('../.github/workflows/apple-ipad-readiness.yml', import.meta.url), 'utf8')
  assert.match(workflow, /on:\n  workflow_dispatch:/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /persist-credentials: false/)
  assert.equal((workflow.match(/secrets\./g) ?? []).length, 3)
  assert.ok(workflow.indexOf('node --test') < workflow.indexOf('secrets.APPLE_API_KEY_P8'))
  assert.doesNotMatch(workflow, /upload-artifact|GITHUB_OUTPUT|pull_request|pull_request_target|push:|npm install|pnpm install|set -x/)
  for (const line of workflow.split('\n').filter(line => line.includes('uses:'))) assert.match(line, /@[a-f0-9]{40}\b/)
})
