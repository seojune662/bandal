import { createPrivateKey, sign } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const origin = 'https://api.appstoreconnect.apple.com'
const bundleId = 'app.bandal.ipad'
const expectedProducts = ['app.bandal.ipad.sync.monthly', 'app.bandal.ipad.sync.yearly']
const subscriptionStates = new Set(['MISSING_METADATA', 'READY_TO_SUBMIT', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'DEVELOPER_ACTION_NEEDED', 'PENDING_BINARY_APPROVAL', 'APPROVED', 'DEVELOPER_REMOVED_FROM_SALE', 'REMOVED_FROM_SALE', 'REJECTED'])
const subscriptionPeriods = new Set(['ONE_WEEK', 'ONE_MONTH', 'TWO_MONTHS', 'THREE_MONTHS', 'SIX_MONTHS', 'ONE_YEAR'])
const credentialNames = ['APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
const safeID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function emptyReport() {
  return {
    schemaVersion: 1,
    target: bundleId,
    mode: 'read-only',
    configuration: 'unknown',
    authentication: 'unknown',
    app: { status: 'unknown', notifications: { production: 'unknown', sandbox: 'unknown', productionVersion: 'unknown', sandboxVersion: 'unknown' } },
    bundleId: { status: 'unknown' },
    capabilities: { status: 'unknown', inAppPurchase: 'unknown', signInWithApple: 'unknown' },
    subscriptionGroups: { status: 'unknown' },
    subscriptions: expectedProducts.map(productId => ({ productId, status: 'unknown', state: 'unknown', period: 'unknown' })),
    requests: [],
    limitations: {
      writePermission: 'unknown',
      paidAppsAgreement: 'unknown',
      inAppPurchaseServerKey: 'unknown',
      newAppCreation: 'requires-app-store-connect-website',
      purchaseAndDistributionReadiness: 'not-established-by-this-check'
    }
  }
}

function credentialsFrom(env) {
  if (credentialNames.some(name => typeof env[name] !== 'string' || !env[name].trim())) return { error: 'missing_credentials' }
  try {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(env.APPLE_API_KEY_ID) || !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(env.APPLE_API_ISSUER)) return { error: 'invalid_credentials' }
    const key = createPrivateKey(env.APPLE_API_KEY_P8)
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return { error: 'invalid_credentials' }
    return { key, id: env.APPLE_API_KEY_ID, issuer: env.APPLE_API_ISSUER }
  } catch { return { error: 'invalid_credentials' } }
}

function tokenFor(credentials, url, now) {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const iat = Math.floor(now() / 1000)
  const message = `${encoded({ alg: 'ES256', kid: credentials.id, typ: 'JWT' })}.${encoded({ iss: credentials.issuer, iat, exp: iat + 120, aud: 'appstoreconnect-v1', scope: [`GET ${url.pathname}${url.search}`] })}`
  return `${message}.${sign('sha256', Buffer.from(message), { key: credentials.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

function endpoint(path, query = {}) {
  const url = new URL(path, origin)
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  url.searchParams.set('limit', '200')
  return url
}

function nextPage(next, initial) {
  // Never follow a server-supplied URL directly. Only an opaque pagination cursor
  // may change, and only on the exact resource/filter originally requested.
  const url = new URL(next, origin)
  if (url.origin !== origin || url.username || url.password || url.hash || url.pathname !== initial.pathname) throw new Error('invalid_pagination')
  for (const name of url.searchParams.keys()) {
    if (url.searchParams.getAll(name).length !== 1 || (name !== 'cursor' && name !== 'limit' && url.searchParams.get(name) !== initial.searchParams.get(name))) throw new Error('invalid_pagination')
  }
  for (const [name, value] of initial.searchParams) {
    if (name !== 'limit' && url.searchParams.get(name) !== value) throw new Error('invalid_pagination')
  }
  const cursor = url.searchParams.get('cursor')
  if (!cursor || cursor.length > 2048) throw new Error('invalid_pagination')
  const result = new URL(initial)
  result.searchParams.set('cursor', cursor)
  return result
}

async function boundedJSON(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('invalid_response')
  const chunks = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > 2 * 1024 * 1024) throw new Error('invalid_response')
      chunks.push(part.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}) }
}

/** No network access occurs at import time. Tests supply throwaway keys and fetch. */
export async function inspectAppleReadiness({ env = {}, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const report = emptyReport()
  const credentials = credentialsFrom(env)
  report.configuration = credentials.error ?? 'available'
  if (credentials.error) return report
  let rejected = false
  let requestCount = 0

  async function list(resource, initial, type, validateAttributes = () => true) {
    let url = initial
    const rows = []
    const visited = new Set()
    for (let page = 0; page < 10; page += 1) {
      if (rejected) return null
      if (++requestCount > 32 || visited.has(url.href)) {
        report.requests.push({ resource, result: 'pagination_limit' })
        return null
      }
      visited.add(url.href)
      let response
      try {
        // No configurable host, redirects, cookies, body, or write method.
        response = await fetchImpl(url.href, {
          method: 'GET', redirect: 'error', credentials: 'omit',
          headers: { Authorization: `Bearer ${tokenFor(credentials, url, now)}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000)
        })
      } catch {
        report.requests.push({ resource, result: 'transport_error' })
        return null
      }
      if (response.status !== 200) {
        const result = response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate_limited' : 'http_error'
        report.requests.push({ resource, result, httpStatus: response.status })
        if (response.status === 401) { rejected = true; report.authentication = 'rejected' }
        // Do not parse, stringify, or log error bodies, which may echo secrets.
        await response.body?.cancel().catch(() => {})
        return null
      }
      report.authentication = 'accepted'
      let body
      try {
        body = await boundedJSON(response)
        if (!object(body) || !Array.isArray(body.data) || !body.data.every(row => object(row) && row.type === type && safeID(row.id) && object(row.attributes) && validateAttributes(row.attributes))) throw new Error('invalid_response')
        if (body.links !== undefined && (!object(body.links) || (body.links.next !== undefined && body.links.next !== null && typeof body.links.next !== 'string'))) throw new Error('invalid_response')
      } catch {
        report.requests.push({ resource, result: 'invalid_response' })
        return null
      }
      rows.push(...body.data)
      report.requests.push({ resource, result: 'ok' })
      if (!body.links?.next) return rows
      try { url = nextPage(body.links.next, initial) } catch {
        report.requests.push({ resource, result: 'invalid_pagination' })
        return null
      }
    }
    report.requests.push({ resource, result: 'pagination_limit' })
    return null
  }

  const apps = await list('apps', endpoint('/v1/apps', { 'filter[bundleId]': bundleId, 'fields[apps]': 'bundleId,subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox' }), 'apps', attrs => attrs.bundleId === bundleId)
  // Validate filtered responses too: an unrelated record must never select an app.
  const app = apps?.length === 1 && apps[0].attributes.bundleId === bundleId ? apps[0] : null
  if (apps && apps.length > 1) report.requests.push({ resource: 'apps', result: 'ambiguous_response' })
  report.app.status = app ? 'present' : apps?.length === 0 ? 'missing' : 'unknown'
  if (app) {
    const attrs = app.attributes
    for (const [key, urlField, versionField] of [['production', 'subscriptionStatusUrl', 'subscriptionStatusUrlVersion'], ['sandbox', 'subscriptionStatusUrlForSandbox', 'subscriptionStatusUrlVersionForSandbox']]) {
      report.app.notifications[key] = typeof attrs[urlField] === 'string' && attrs[urlField].length > 0 ? 'configured' : attrs[urlField] === null || attrs[urlField] === '' ? 'missing' : 'unknown'
      report.app.notifications[`${key}Version`] = ['V1', 'V2'].includes(attrs[versionField]) ? attrs[versionField] : 'unknown'
    }
  }

  const bundles = await list('bundleIds', endpoint('/v1/bundleIds', { 'filter[identifier]': bundleId, 'fields[bundleIds]': 'identifier,platform' }), 'bundleIds', attrs => attrs.identifier === bundleId)
  const bundle = bundles?.length === 1 && bundles[0].attributes.identifier === bundleId ? bundles[0] : null
  if (bundles && bundles.length > 1) report.requests.push({ resource: 'bundleIds', result: 'ambiguous_response' })
  report.bundleId.status = bundle ? 'present' : bundles?.length === 0 ? 'missing' : 'unknown'
  if (bundle) {
    const capabilities = await list('capabilities', endpoint(`/v1/bundleIds/${bundle.id}/bundleIdCapabilities`, { 'fields[bundleIdCapabilities]': 'capabilityType' }), 'bundleIdCapabilities', attrs => typeof attrs.capabilityType === 'string' && attrs.capabilityType.length > 0)
    if (capabilities) {
      report.capabilities = {
        status: 'checked',
        inAppPurchase: capabilities.some(row => row.attributes.capabilityType === 'IN_APP_PURCHASE') ? 'listed' : 'not_listed',
        signInWithApple: capabilities.some(row => row.attributes.capabilityType === 'APPLE_ID_AUTH') ? 'listed' : 'not_listed'
      }
    }
  }

  if (app) {
    const groups = await list('subscriptionGroups', endpoint(`/v1/apps/${app.id}/subscriptionGroups`, { 'fields[subscriptionGroups]': 'referenceName' }), 'subscriptionGroups')
    if (groups) {
      report.subscriptionGroups = { status: groups.length ? 'present' : 'missing', count: groups.length }
      const products = []
      let complete = true
      for (const group of groups) {
        const subscriptions = await list('subscriptions', endpoint(`/v1/subscriptionGroups/${group.id}/subscriptions`, { 'filter[productId]': expectedProducts.join(','), 'fields[subscriptions]': 'productId,state,subscriptionPeriod' }), 'subscriptions', attrs => expectedProducts.includes(attrs.productId))
        if (subscriptions) products.push(...subscriptions)
        else { complete = false; break }
      }
      for (const product of report.subscriptions) {
        const matches = products.filter(row => row.attributes.productId === product.productId)
        if (matches.length === 1) {
          product.status = complete ? 'present' : 'unknown'
          product.state = subscriptionStates.has(matches[0].attributes.state) ? matches[0].attributes.state : 'unknown'
          product.period = subscriptionPeriods.has(matches[0].attributes.subscriptionPeriod) ? matches[0].attributes.subscriptionPeriod : 'unknown'
        } else if (matches.length === 0 && complete) product.status = 'missing'
        else if (matches.length > 1) report.requests.push({ resource: 'subscriptions', result: 'ambiguous_response' })
      }
    }
  } else if (report.app.status === 'missing') {
    report.subscriptionGroups.status = 'missing'
    for (const product of report.subscriptions) product.status = 'missing'
  }
  return report
}

export function readinessSummary(report) {
  // report is built exclusively from constants, enums, counts and booleans above.
  // No server-provided names, IDs, URLs, error details, credentials or JWTs appear.
  return `## Apple iPad read-only readiness\n\nThis checks existing records only; it does not establish release or purchase readiness.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\nAn ASC/notarization key is not an In-App Purchase server key. Creating a new app record requires App Store Connect's website. Key write permissions, Paid Apps agreements, banking/tax setup and the separate IAP server key remain unverified.\n`
}

export async function main({ env = process.env, fetchImpl = globalThis.fetch, write = text => process.stdout.write(text), summary = text => env.GITHUB_STEP_SUMMARY ? appendFile(env.GITHUB_STEP_SUMMARY, text) : Promise.resolve() } = {}) {
  let report
  try { report = await inspectAppleReadiness({ env, fetchImpl }) } catch {
    // Never emit exception messages/stacks: crypto/fetch errors may contain inputs.
    report = emptyReport()
    report.requests.push({ resource: 'probe', result: 'internal_error' })
  }
  write(`${JSON.stringify(report, null, 2)}\n`)
  try { await summary(readinessSummary(report)) } catch {
    write('{"summary":"unavailable"}\n')
    return 1
  }
  return report.configuration !== 'available' || report.requests.some(request => request.result !== 'ok') ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
