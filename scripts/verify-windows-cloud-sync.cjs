#!/usr/bin/env node
// Manual, bounded QA against one pre-provisioned account. No admin credentials,
// refresh, user creation, entitlement mutation, or remote deletion on Actions.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const PROJECT = 'ukacrkcwiqafwpppshxb', PURPOSE = 'Bandal isolated sync validation'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{40}$/
class QAError extends Error { constructor(code) { super(code); this.code = code } }
function check(value, code) { if (!value) throw new QAError(code) }
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const writeJSON = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
}

function descriptor(raw, now = Date.now()) {
  check(typeof raw === 'string' && raw.length < 4096, 'qa_manifest_size')
  let m; try { m = JSON.parse(raw) } catch { throw new QAError('qa_manifest_json') }
  const fields = ['runID', 'userID', 'courseID', 'projectURL', 'pdfSHA', 'desktopInkID', 'notePath', 'pdfPath', 'expectedDesktopMarkdown', 'expectedNativeMarkdown', 'expiresAt']
  check(m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length === fields.length && fields.every(k => Object.hasOwn(m, k)), 'qa_manifest_fields')
  for (const key of ['runID', 'userID', 'courseID', 'desktopInkID']) check(UUID.test(m[key]), 'qa_manifest_uuid')
  check(m.projectURL === `https://${PROJECT}.supabase.co`, 'qa_project_mismatch')
  check(SHA.test(m.pdfSHA) && m.notePath === 'roundtrip.md' && m.pdfPath === 'roundtrip.pdf', 'qa_seed_invalid')
  check(m.expectedDesktopMarkdown === 'Mac → iPad ' + m.runID, 'qa_seed_marker')
  check(['iPad → Mac ', 'iPad → Windows '].some(prefix => m.expectedNativeMarkdown === prefix + m.runID), 'qa_native_marker')
  const expiry = Date.parse(m.expiresAt)
  check(Number.isFinite(expiry) && expiry > now && expiry < now + 65 * 60_000, 'qa_grant_expiry')
  return m
}

function claimsFor(token, m, now = Date.now()) {
  check(typeof token === 'string' && token.length > 100 && token.length < 16_384, 'qa_access_token_missing')
  const parts = token.split('.'); check(parts.length === 3, 'qa_access_token_format')
  let c; try { c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) } catch { throw new QAError('qa_access_token_format') }
  check(c && typeof c === 'object' && !Array.isArray(c), 'qa_access_token_format')
  check(c.role === 'authenticated' && c.aud === 'authenticated' && c.sub === m.userID && c.iss === m.projectURL + '/auth/v1', 'qa_access_token_scope')
  check(Number.isSafeInteger(c.exp) && c.exp * 1000 > now + 60_000 && c.exp * 1000 < now + 65 * 60_000, 'qa_access_token_expiry')
  // These claims are not proof of authenticity. authenticate() MUST verify the
  // same token with GoTrue before any local or cloud write.
  return c
}

function validateIdentity(identity, m) {
  check(identity?.id === m.userID && identity.email === `bandal-qa-${m.runID}@example.invalid` && identity.user_metadata?.validationRun === m.runID && identity.user_metadata?.purpose === PURPOSE, 'qa_identity_mismatch')
}

function childEnvironment(source, extra = {}) {
  const allowed = new Set(['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile', 'appdata', 'localappdata', 'comspec', 'pathext', 'lang'])
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase()))), ...extra }
}

async function jsonRequest(url, headers, body) {
  let response
  try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { ...headers, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) }) }
  catch { throw new QAError('qa_request_failed') }
  check(response.ok, `qa_http_${response.status}`)
  try { return await response.json() } catch { throw new QAError('qa_response_invalid') }
}

async function authenticate(m, env) {
  const token = env.BANDAL_CLOUD_QA_ACCESS_TOKEN, publicKey = env.BANDAL_SUPABASE_PUBLISHABLE_KEY
  claimsFor(token, m)
  check(typeof publicKey === 'string' && publicKey.length > 30 && !publicKey.startsWith('sb_secret_'), 'qa_public_key_missing')
  if (!publicKey.startsWith('sb_publishable_')) {
    let keyClaims; try { keyClaims = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString('utf8')) } catch { throw new QAError('qa_public_key_invalid') }
    check(keyClaims.role === 'anon' && keyClaims.ref === PROJECT, 'qa_public_key_invalid')
  }
  const headers = { apikey: publicKey, Authorization: 'Bearer ' + token }
  validateIdentity(await jsonRequest(m.projectURL + '/auth/v1/user', headers), m)
  const status = await jsonRequest(m.projectURL + '/rest/v1/rpc/bandal_sync_status', headers, {})
  check(status.writeAllowed === true && status.accessSource === 'beta' && status.enforcePaidAccess === true && status.storageLimitBytes === 5368709120, 'qa_beta_access_required')
  return { token, publicKey }
}

function verifyArtifact(root) {
  const dir = path.join(root, 'resources/native/ipad-bridge/win32-x64')
  const m = readJSON(path.join(dir, 'manifest.json')), binary = path.join(dir, 'bandal-ipad-bridge.exe')
  check(m.platform === 'win32' && m.arch === 'x64' && SHA.test(m.sourceHash) && SHA.test(m.binaryHash), 'qa_companion_manifest')
  check(m.sourceHash === hash(fs.readFileSync(path.join(root, 'resources/ipad-bridge/bridge.py'))), 'qa_companion_source_mismatch')
  check(m.binaryHash === hash(fs.readFileSync(binary)), 'qa_companion_binary_mismatch')
  return { binary, sourceHash: m.sourceHash, binaryHash: m.binaryHash }
}

function localRoot() {
  check(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP), 'qa_runner_temp_required')
  return path.join(process.env.RUNNER_TEMP, 'bandal-windows-cloud-qa')
}

async function preflight(root, m) {
  const sha = process.env.QA_SOURCE_SHA, runID = process.env.QA_COMPANION_RUN_ID
  check(COMMIT.test(sha) && /^[1-9][0-9]{0,15}$/.test(runID), 'qa_source_inputs')
  check(process.env.GITHUB_REPOSITORY === 'seojune662/bandal' && process.env.GITHUB_REF === 'refs/heads/main', 'qa_repository_scope')
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  check(git(['rev-parse', 'HEAD']).stdout.trim() === sha && git(['merge-base', '--is-ancestor', sha, 'origin/main']).status === 0, 'qa_source_not_main')
  check(process.env.GH_TOKEN, 'qa_actions_token_missing')
  const headers = { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const base = 'https://api.github.com/repos/seojune662/bandal/actions/runs/' + runID
  const run = await jsonRequest(base, headers)
  check(run.repository?.full_name === 'seojune662/bandal' && run.head_repository?.full_name === 'seojune662/bandal' && run.path === '.github/workflows/release.yml' && run.status === 'completed' && ['push', 'workflow_dispatch'].includes(run.event) && COMMIT.test(run.head_sha), 'qa_untrusted_companion_run')
  const jobs = await jsonRequest(base + '/jobs?per_page=100', headers)
  check(jobs.jobs?.some(job => job.name === 'iPad companion win32-x64' && job.conclusion === 'success'), 'qa_companion_build_not_successful')
  const artifacts = await jsonRequest(base + '/artifacts?per_page=100', headers)
  const matches = artifacts.artifacts?.filter(a => a.name === 'ipad-bridge-win32-x64' && !a.expired) ?? []
  check(matches.length === 1 && matches[0].workflow_run?.head_sha === run.head_sha, 'qa_companion_artifact_missing')
  writeJSON(path.join(localRoot(), 'evidence/source.json'), { sourceSHA: sha, companionRunID: runID, companionSourceSHA: run.head_sha, artifactID: matches[0].id, runID: m.runID })
  console.log('Source, isolated QA manifest, and successful companion artifact verified.')
}

function progressStatus(status) {
  check(status && status.scope === 'personal-content-v1' && status.access?.writeAllowed === true && status.access?.accessSource === 'beta', 'qa_cycle_access_invalid')
  for (const key of ['pending', 'deferred', 'conflicts']) check(Number.isSafeInteger(status[key]) && status[key] >= 0 && status[key] <= 10_000, 'qa_cycle_status_invalid')
  check(typeof status.projectionPending === 'boolean', 'qa_cycle_status_invalid')
  return { scope: status.scope, pending: status.pending, deferred: status.deferred, conflicts: status.conflicts, projectionPending: status.projectionPending, writeAllowed: true, accessSource: 'beta' }
}

function safeStatus(status) {
  const result = progressStatus(status)
  check(result.pending === 0 && result.deferred === 0 && result.conflicts === 0, 'qa_cycle_unsettled')
  check(result.projectionPending === false, 'qa_projection_pending')
  return result
}

async function settleCycles(cycle, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  // A newly imported record may queue a canonical follow-up during projection.
  // Allow bounded settling; final evidence still requires zero unfinished work.
  for (let attempt = 0; attempt < 5; attempt++) {
    const status = cycle(), progress = progressStatus(status)
    check(progress.conflicts === 0, 'qa_cycle_conflict')
    if (!progress.pending && !progress.deferred && !progress.projectionPending) return safeStatus(status)
    if (attempt < 4) await sleep(2000)
  }
  throw new QAError('qa_cycle_unsettled')
}

async function desktop(phase, root, m) {
  check(process.platform === 'win32' && process.versions.electron, 'qa_windows_electron_required')
  const credential = await authenticate(m, process.env), artifact = verifyArtifact(root)
  const desktopRequire = createRequire(path.join(root, 'package.json'))
  const SQLite = desktopRequire('better-sqlite3'), { PDFDocument } = desktopRequire('pdf-lib')
  const work = localRoot(), profile = path.join(work, 'profile'), courses = path.join(work, 'courses'), exchange = path.join(work, 'exchange')
  const databasePath = path.join(profile, 'bandal.db'), helper = path.join(root, 'resources/ipad-bridge/projector-host.cjs'), bundle = path.join(root, 'resources/ipad-bridge/backend.js')
  const statePath = path.join(work, 'windows-state.json')
  const cycle = () => {
    claimsFor(credential.token, m)
    const result = spawnSync(artifact.binary, ['cycle', '--desktop-db', databasePath, '--exchange', exchange, '--course-root', courses], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      env: childEnvironment(process.env, { ELECTRON_RUN_AS_NODE: '1', BANDAL_SUPABASE_URL: m.projectURL, BANDAL_SUPABASE_KEY: credential.publicKey,
        BANDAL_USER_ID: m.userID, BANDAL_ACCESS_TOKEN: credential.token, BANDAL_DESKTOP_PROJECTOR: helper,
        BANDAL_DESKTOP_RUNTIME: process.execPath, BANDAL_DESKTOP_MODULE_ROOT: root, BANDAL_DESKTOP_BACKEND: bundle })
    })
    check(result.status === 0, 'qa_companion_cycle_failed')
    let summaries; try { summaries = result.stdout.trim().split('\n').map(line => JSON.parse(line)) } catch { throw new QAError('qa_companion_output_invalid') }
    const status = summaries.filter(row => row.status).at(-1)?.status
    console.log(JSON.stringify({ phase, cycle: progressStatus(status) }))
    if (status.conflicts) {
      const db = new SQLite(databasePath, { readonly: true })
      try {
        const conflicts = db.prepare('SELECT record_id,reason FROM ipad_sync_conflicts WHERE resolved_at IS NULL LIMIT 100').all()
          .map(row => ({ kind: String(row.record_id).split(':')[0], reason: String(row.reason).slice(0, 512) }))
        writeJSON(path.join(work, 'evidence/conflicts.json'), { runID: m.runID, phase, conflicts })
        console.log(JSON.stringify({ phase, conflicts }))
      } finally { db.close() }
    }
    return status
  }
  const inspect = async () => {
    const db = new SQLite(databasePath, { readonly: true })
    try {
      const rows = db.prepare('SELECT id,name,folder_path FROM courses WHERE deleted_at IS NULL').all()
      check(rows.length === 1 && rows[0].id === m.courseID && rows[0].name === 'Bandal isolated QA ' + m.runID, 'qa_course_scope')
      const directory = fs.realpathSync(rows[0].folder_path), approved = fs.realpathSync(courses)
      check(directory.startsWith(approved + path.sep), 'qa_course_path')
      const bytes = fs.readFileSync(path.join(directory, m.pdfPath))
      const ink = db.prepare('SELECT id,page,data_json FROM pdf_drawings WHERE course_id=? AND rel_path=? AND deleted_at IS NULL').all(m.courseID, m.pdfPath)
      check(ink.every(row => JSON.parse(row.data_json).inkVersion === 5), 'qa_ink_version')
      return { directory, markdown: fs.readFileSync(path.join(directory, m.notePath), 'utf8'), pdfSHA: hash(bytes), pages: (await PDFDocument.load(bytes)).getPageCount(), ink }
    } finally { db.close() }
  }
  if (phase === 'prepare') {
    check(!fs.existsSync(databasePath) && !fs.existsSync(statePath), 'qa_windows_profile_not_fresh')
    for (const directory of [profile, courses, exchange]) fs.mkdirSync(directory, { recursive: true })
    const initial = new SQLite(databasePath); initial.exec(fs.readFileSync(path.join(root, 'src/main/db/schema.sql'), 'utf8')); initial.close()
    await require(helper).run({ action: 'export', database: databasePath, exchange, courseRoot: courses, moduleRoot: root, bundle, request: { scope: 'personal-content-v1' } })
    await settleCycles(cycle)
    const seed = await inspect()
    check(seed.markdown === m.expectedDesktopMarkdown && seed.pdfSHA === m.pdfSHA && seed.pages === 2 && seed.ink.length === 1 && seed.ink[0].id === m.desktopInkID && seed.ink[0].page === 1, 'qa_mac_seed_mismatch')
    const windowsInkID = crypto.randomUUID(), marker = 'Windows → iPad ' + m.runID
    fs.writeFileSync(path.join(seed.directory, m.notePath), marker)
    const db = new SQLite(databasePath), now = new Date().toISOString()
    try {
      db.prepare('INSERT INTO pdf_drawings(id,course_id,rel_path,page,kind,data_json,style_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(windowsInkID, m.courseID, m.pdfPath, 1, 'ink', JSON.stringify({ inkVersion: 5, points: [{ x: .2, y: .6, p: .5, t: 0 }, { x: .7, y: .8, p: .8, t: 20 }] }), JSON.stringify({ color: 'ink', width: .004, opacity: 1 }), now, now)
    } finally { db.close() }
    const status = await settleCycles(cycle), source = readJSON(path.join(work, 'evidence/source.json'))
    const state = { runID: m.runID, courseID: m.courseID, windowsInkID, expectedDesktopMarkdown: marker }
    writeJSON(statePath, state)
    writeJSON(path.join(work, 'evidence/windows-ready.json'), { ...source, ...state, userID: m.userID, pdfSHA: m.pdfSHA, companionSourceHash: artifact.sourceHash, companionBinaryHash: artifact.binaryHash, status })
    console.log('Windows changes published. Download the readiness artifact, update the physical iPad fixture marker, and run the native test now.')
  } else {
    check(phase === 'verify', 'qa_phase_invalid')
    const state = readJSON(statePath)
    check(state.runID === m.runID && state.courseID === m.courseID && UUID.test(state.windowsInkID), 'qa_windows_state_mismatch')
    const deadline = Math.min(Date.now() + 15 * 60_000, Date.parse(m.expiresAt) - 90_000)
    let attempts = 0
    while (Date.now() < deadline) {
      const status = await settleCycles(cycle), snapshot = await inspect(); attempts++
      const nativeInk = snapshot.ink.filter(row => row.id !== m.desktopInkID && row.id !== state.windowsInkID)
      if (snapshot.markdown === m.expectedNativeMarkdown && snapshot.pages === 3 &&
          snapshot.ink.find(row => row.id === m.desktopInkID)?.page === 2 && snapshot.ink.find(row => row.id === state.windowsInkID)?.page === 2 && nativeInk.length === 1 && nativeInk[0].page === 3) {
        writeJSON(path.join(work, 'evidence/windows-roundtrip.json'), { ...state, sourceSHA: process.env.QA_SOURCE_SHA, userID: m.userID, pdfSHA: snapshot.pdfSHA, nativeInkID: nativeInk[0].id, pdfPageCount: 3, markdown: true, macInkMovedToPage: 2, windowsInkMovedToPage: 2, nativeInkOnPage: 3, inkVersion: 5, status, attempts })
        console.log('Physical iPad changes imported into Windows; compare this evidence PDF hash and native ink ID with native-result.json.')
        return
      }
      check(snapshot.markdown === state.expectedDesktopMarkdown || snapshot.markdown === m.expectedNativeMarkdown, 'qa_unexpected_remote_marker')
      if (attempts % 6 === 0) console.log('Waiting for the physical iPad marker; QA scope remains isolated.')
      await new Promise(resolve => setTimeout(resolve, 10_000))
    }
    throw new QAError('qa_physical_ipad_timeout')
  }
}

async function main() {
  const [phase, next] = process.argv.slice(2)
  if (phase === 'clean-local') { fs.rmSync(localRoot(), { recursive: true, force: true }); return }
  check(process.env.QA_DESKTOP_ROOT && path.isAbsolute(process.env.QA_DESKTOP_ROOT), 'qa_desktop_root_required')
  const root = fs.realpathSync(process.env.QA_DESKTOP_ROOT)
  const m = descriptor(process.env.QA_MANIFEST_JSON)
  if (phase === 'preflight') return preflight(root, m)
  if (phase === 'artifact') { const value = verifyArtifact(root); console.log(JSON.stringify({ sourceHash: value.sourceHash, binaryHash: value.binaryHash })); return }
  if (phase === 'launch') {
    check(['prepare', 'verify'].includes(next), 'qa_phase_invalid')
    const electron = createRequire(path.join(root, 'package.json'))('electron')
    const result = spawnSync(electron, [__filename, next], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    check(result.status === 0, 'qa_electron_driver_failed'); return
  }
  return desktop(phase, root, m)
}

module.exports = { QAError, descriptor, claimsFor, validateIdentity, authenticate, childEnvironment, verifyArtifact, safeStatus, settleCycles }
if (require.main === module) main().catch(error => { console.error(error instanceof QAError ? error.code : 'qa_unexpected_failure'); process.exitCode = 1 })
