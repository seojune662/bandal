import { createPrivateKey, sign } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const origin = 'https://api.appstoreconnect.apple.com'
const target = 'app.bandal.ipad'
const expectedTeam = 'VUZ7Z98BW3'
const expectedAttributes = { identifier: target, name: 'Bandal iPad', platform: 'IOS', seedId: expectedTeam }
const primarySettings = [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT', enabled: true }] }]
const safeID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function emptyReport() {
  return {
    schemaVersion: 1, target, mode: 'fixed-identifier-registration',
    configuration: 'unknown', teamConfiguration: 'unknown', authentication: 'unknown',
    outcome: 'blocked', reason: 'not_started',
    bundleId: { status: 'unknown', write: 'not_attempted' },
    signInWithApple: { status: 'unknown', write: 'not_attempted' },
    requests: [],
    limitations: {
      issuerTeamIndependentlyVerified: false,
      postTokenRestriction: 'short-lived-key-role-with-fixed-client-allowlist',
      appRecord: 'requires-app-store-connect-website',
      agreementsAndPurchaseKeys: 'not-configured',
      distributionReadiness: 'not-established-by-this-setup'
    }
  }
}

function credentialsFrom(env) {
  if (['APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_TEAM_ID'].some(name => typeof env[name] !== 'string' || !env[name].trim())) return { error: 'missing_credentials' }
  if (env.APPLE_TEAM_ID !== expectedTeam) return { error: 'team_configuration_mismatch' }
  try {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(env.APPLE_API_KEY_ID) || !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(env.APPLE_API_ISSUER)) return { error: 'invalid_credentials' }
    const key = createPrivateKey(env.APPLE_API_KEY_P8)
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return { error: 'invalid_credentials' }
    return { key, id: env.APPLE_API_KEY_ID, issuer: env.APPLE_API_ISSUER }
  } catch { return { error: 'invalid_credentials' } }
}

function tokenFor(credentials, method, url, now) {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const iat = Math.floor(now() / 1000)
  const payload = { iss: credentials.issuer, iat, exp: iat + 120, aud: 'appstoreconnect-v1' }
  // Apple documents scope entries for GET only. Writes use a short-lived token
  // under the key's role, restricted here to the fixed write requests below.
  if (method === 'GET') payload.scope = [`GET ${url.pathname}${url.search}`]
  const message = `${encoded({ alg: 'ES256', kid: credentials.id, typ: 'JWT' })}.${encoded(payload)}`
  return `${message}.${sign('sha256', Buffer.from(message), { key: credentials.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

function endpoint(path, query = {}) {
  const url = new URL(path, origin)
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
  return url
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
      if (length > 1024 * 1024) throw new Error('invalid_response')
      chunks.push(part.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}) }
}

const isResource = (row, type) => object(row) && row.type === type && safeID(row.id) && object(row.attributes)
// Apple may normalize an IOS creation request to UNIVERSAL. That documented
// platform includes iOS; it does not create additional App Store app records.
const matchesBundle = row => isResource(row, 'bundleIds') && Object.entries(expectedAttributes).every(([key, value]) =>
  key === 'platform' ? ['IOS', 'UNIVERSAL'].includes(row.attributes[key]) : row.attributes[key] === value)
const bundleValidation = row => ({
  resource: isResource(row, 'bundleIds') ? 'valid' : 'invalid',
  ...Object.fromEntries(Object.entries(expectedAttributes).map(([key, value]) => [key, row?.attributes?.[key] === value ? 'matched' : row?.attributes?.[key] == null ? 'missing' : 'mismatched'])),
  returnedPlatform: ['IOS', 'MAC_OS', 'UNIVERSAL'].includes(row?.attributes?.platform) ? row.attributes.platform : 'unknown'
})
const isPrimary = row => Array.isArray(row.attributes.settings) && row.attributes.settings.filter(setting => setting?.key === 'APPLE_ID_AUTH_APP_CONSENT').length === 1 &&
  row.attributes.settings.some(setting => setting?.key === 'APPLE_ID_AUTH_APP_CONSENT' && Array.isArray(setting.options) &&
    setting.options.filter(option => option?.key === 'PRIMARY_APP_CONSENT').length === 1 &&
    setting.options.some(option => option?.key === 'PRIMARY_APP_CONSENT' && option.enabled === true))
const capabilityValidation = row => {
  const settings = Array.isArray(row?.attributes?.settings) ? row.attributes.settings : []
  const primary = settings.filter(setting => setting?.key === 'APPLE_ID_AUTH_APP_CONSENT')
  const options = primary.flatMap(setting => Array.isArray(setting.options) ? setting.options : []).filter(option => option?.key === 'PRIMARY_APP_CONSENT')
  return { resource: isResource(row, 'bundleIdCapabilities') ? 'valid' : 'invalid', capabilityType: row?.attributes?.capabilityType === 'APPLE_ID_AUTH' ? 'matched' : 'mismatched', settingsReturned: Array.isArray(row?.attributes?.settings), settingCount: settings.length, primarySettingCount: primary.length, primaryOptionCount: options.length, primaryEnabledCount: options.filter(option => option.enabled === true).length }
}

/** No network activity at import time. Callers can only supply credentials,
 * clock and transport; identifiers, methods, payloads and hosts stay fixed. */
export async function registerAppleIPad({ env = {}, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const report = emptyReport()
  const credentials = credentialsFrom(env)
  report.configuration = credentials.error ?? 'available'
  report.teamConfiguration = env.APPLE_TEAM_ID === expectedTeam ? 'matched' : 'unverified'
  if (credentials.error) { report.reason = credentials.error; return report }
  const stop = reason => { report.reason = reason; return report }
  let primaryCapabilityPath = null

  async function request(resource, method, url, body) {
    const allowedWrite = method === 'POST' && ['/v1/bundleIds', '/v1/bundleIdCapabilities'].includes(url.pathname) ||
      method === 'PATCH' && primaryCapabilityPath !== null && url.pathname === primaryCapabilityPath
    if (url.origin !== origin || url.username || url.password || url.hash ||
      (method !== 'GET' && (url.search || !allowedWrite))) {
      report.reason = 'request_boundary_rejected'
      return null
    }
    let response
    try {
      response = await fetchImpl(url.href, {
        method, redirect: 'error', credentials: 'omit',
        headers: { Authorization: `Bearer ${tokenFor(credentials, method, url, now)}`, Accept: 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000)
      })
    } catch {
      report.requests.push({ resource, method, result: 'transport_error' })
      report.reason = method !== 'GET' ? 'write_outcome_unknown' : 'transport_error'
      return null
    }
    if (response.status !== (method === 'POST' ? 201 : 200)) {
      const result = response.status === 401 ? 'authentication_failed' : response.status === 403 ? 'forbidden' : response.status === 409 ? 'conflict' : response.status === 429 ? 'rate_limited' : 'http_error'
      report.requests.push({ resource, method, result, httpStatus: response.status })
      report.reason = result
      if (response.status === 401) report.authentication = 'rejected'
      // Never read, log or retry an error body; it may contain echoed secrets.
      await response.body?.cancel().catch(() => {})
      return null
    }
    report.authentication = 'accepted'
    try {
      const result = await boundedJSON(response)
      if (!object(result)) throw new Error('invalid_response')
      report.requests.push({ resource, method, result: 'ok' })
      return result
    } catch {
      report.requests.push({ resource, method, result: 'invalid_response' })
      report.reason = method !== 'GET' ? 'write_outcome_unknown' : 'invalid_response'
      return null
    }
  }

  function completeList(body, type) {
    // An exact identifier should return at most one record and capabilities fit
    // in one 200-item page. Never infer absence from an incomplete response or
    // follow a server-provided link (including pagination/redirect targets).
    return Array.isArray(body.data) && body.data.every(row => isResource(row, type) &&
      (type !== 'bundleIdCapabilities' || (typeof row.attributes.capabilityType === 'string' && row.attributes.capabilityType.length > 0))) &&
      (body.links === undefined || (object(body.links) && (body.links.next === undefined || body.links.next === null)))
  }
  const bundleQuery = () => endpoint('/v1/bundleIds', { 'filter[identifier]': target, 'fields[bundleIds]': 'identifier,name,platform,seedId', limit: '200' })
  let body = await request('bundleId', 'GET', bundleQuery())
  if (!body) return report
  if (!completeList(body, 'bundleIds') || body.data.length > 1) return stop('ambiguous_or_incomplete_bundle_response')
  let bundle = body.data[0]
  if (bundle && !matchesBundle(bundle)) {
    report.bundleId.validation = bundleValidation(bundle)
    return stop('bundle_attributes_mismatch')
  }
  if (!bundle) {
    report.bundleId.write = 'attempted'
    report.bundleId.status = 'unverified_after_write'
    const created = await request('bundleId', 'POST', endpoint('/v1/bundleIds'), { data: { type: 'bundleIds', attributes: expectedAttributes } })
    if (!created) return report
    report.bundleId.write = 'accepted'
    if (!matchesBundle(created.data)) {
      report.bundleId.validation = bundleValidation(created.data)
      return stop('created_bundle_response_mismatch')
    }
    body = await request('bundleIdVerification', 'GET', bundleQuery())
    if (!body) return report
    if (!completeList(body, 'bundleIds') || body.data.length !== 1 || !matchesBundle(body.data[0]) || body.data[0].id !== created.data.id) return stop('bundle_verification_failed')
    bundle = body.data[0]
    report.bundleId.status = 'created_verified'
  } else report.bundleId.status = 'reused_verified'

  // Use the complete default capability representation. Production Apple
  // rejected the parameterized relationship query with HTTP 400.
  const capabilityQuery = () => endpoint(`/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)
  body = await request('capabilities', 'GET', capabilityQuery())
  if (!body) return report
  if (!completeList(body, 'bundleIdCapabilities')) return stop('incomplete_capability_response')
  const capabilities = body.data.filter(row => row.attributes.capabilityType === 'APPLE_ID_AUTH')
  if (capabilities.length > 1) return stop('ambiguous_capability_response')
  if (capabilities.length === 1) {
    if (!isPrimary(capabilities[0])) {
      const value = capabilityValidation(capabilities[0])
      report.signInWithApple.validation = value
      // Repair only the single primary setting on this fixed app's capability.
      // Ambiguous or additional settings must not be overwritten.
      const settings = capabilities[0].attributes.settings
      if (value.settingCount !== 1 || value.primarySettingCount !== 1 || value.primaryOptionCount !== 1 || settings[0].options.length !== 1) return stop('existing_sign_in_configuration_mismatch')
      const id = capabilities[0].id
      primaryCapabilityPath = `/v1/bundleIdCapabilities/${id}`
      report.signInWithApple.write = 'attempted'
      report.signInWithApple.status = 'unverified_after_write'
      const updated = await request('primaryConfiguration', 'PATCH', endpoint(primaryCapabilityPath), { data: { type: 'bundleIdCapabilities', id, attributes: { capabilityType: 'APPLE_ID_AUTH', settings: primarySettings } } })
      primaryCapabilityPath = null
      if (!updated) return report
      report.signInWithApple.write = 'accepted'
      if (!isResource(updated.data, 'bundleIdCapabilities') || updated.data.id !== id || updated.data.attributes.capabilityType !== 'APPLE_ID_AUTH') return stop('updated_capability_response_mismatch')
      const checked = await request('primaryVerification', 'GET', capabilityQuery())
      if (!checked) return report
      if (!completeList(checked, 'bundleIdCapabilities')) return stop('capability_verification_failed')
      const primary = checked.data.filter(row => row.attributes.capabilityType === 'APPLE_ID_AUTH')
      if (primary.length !== 1 || primary[0].id !== id || !isPrimary(primary[0])) return stop('primary_configuration_not_verified')
      delete report.signInWithApple.validation
      report.signInWithApple.status = 'configured_verified'
    } else {
      report.signInWithApple.status = 'reused_verified'
    }
  } else {
    report.signInWithApple.write = 'attempted'
    report.signInWithApple.status = 'unverified_after_write'
    const created = await request('signInWithApple', 'POST', endpoint('/v1/bundleIdCapabilities'), {
      data: { type: 'bundleIdCapabilities', attributes: { capabilityType: 'APPLE_ID_AUTH', settings: primarySettings }, relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } } }
    })
    if (!created) return report
    report.signInWithApple.write = 'accepted'
    if (!isResource(created.data, 'bundleIdCapabilities') || created.data.attributes.capabilityType !== 'APPLE_ID_AUTH') return stop('created_capability_response_mismatch')
    body = await request('capabilityVerification', 'GET', capabilityQuery())
    if (!body) return report
    if (!completeList(body, 'bundleIdCapabilities')) return stop('capability_verification_failed')
    const verified = body.data.filter(row => row.attributes.capabilityType === 'APPLE_ID_AUTH')
    if (verified.length !== 1 || verified[0].id !== created.data.id || !isPrimary(verified[0])) {
      report.signInWithApple.validation = capabilityValidation(verified[0])
      return stop('capability_verification_failed')
    }
    report.signInWithApple.status = 'created_verified'
  }
  report.outcome = 'complete'
  report.reason = 'verified'
  return report
}

export function registrationSummary(report) {
  return `## Apple iPad identifier registration\n\nOnly the fixed Bundle ID and primary Sign in with Apple capability are in scope.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\nCreate the app record in the App Store Connect website. Agreements, banking/tax details, subscription products, separate IAP server keys and distribution profiles remain separate setup steps.\n`
}

export async function main({ env = process.env, fetchImpl = globalThis.fetch, write = text => process.stdout.write(text), summary = text => env.GITHUB_STEP_SUMMARY ? appendFile(env.GITHUB_STEP_SUMMARY, text) : Promise.resolve() } = {}) {
  let report
  try { report = await registerAppleIPad({ env, fetchImpl }) } catch {
    report = emptyReport()
    report.reason = 'internal_error'
  }
  write(`${JSON.stringify(report, null, 2)}\n`)
  try { await summary(registrationSummary(report)) } catch { write('{"summary":"unavailable"}\n'); return 1 }
  return report.outcome === 'complete' ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
