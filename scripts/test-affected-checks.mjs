import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedFiles, publishedReleaseBase, resolveCheckBase, onlyAddedLinesChanged, onlyLockedChatDependenciesPromoted, onlyLockedPdfDependencyPromoted, pdfDependencyPromotionInputs, onlyVersionOrBrowserImportHookChanged, onlySwipeRegistrationChanged, onlyHoverPreviewEntryChanged, onlyLiveBillingConfigAdded, PADDLE_BILLING_FUNCTIONS, APPLE_BILLING_FUNCTIONS, ACCOUNT_DELETION_FUNCTIONS, planChecks, scriptTestCommand } from './affected-checks.mjs'
import { matchingRun } from './reuse-ci.mjs'
import { onlyCommunityRegistrationChanged, communityE2eFiles, main as runAffectedChecks } from './affected-checks.mjs'

const communityPreload = {
  file: 'src/preload/index.ts',
  before: "const PUSH_CHANNELS = [\n  'workspace:prepareTransition',\n]\nassertAppRendererSender(event)\n",
  after: "const PUSH_CHANNELS = [\n  'community:open',\n  'workspace:prepareTransition',\n]\nassertAppRendererSender(event)\n"
}
const communityWorkspace = {
  file: 'src/renderer/src/stores/workspaceStore.ts',
  before: `export type WorkspaceHydration = 'idle' | 'loading' | 'ready' | 'error'
export type WorkspaceSurface = 'course' | 'learning-home' | 'study-market'
interface WorkspaceState {
  showStudyMarket: () => void
  showCourseWorkspace: () => void
}
function createWorkspace(set, get, flush) {
  return {
    surface: 'course',
    showCourseWorkspace: () => set({ surface: 'course' }),
  }
}
`,
  after: `export type WorkspaceHydration = 'idle' | 'loading' | 'ready' | 'error'
export type WorkspaceSurface = 'course' | 'learning-home' | 'study-market' | 'community'
interface WorkspaceState {
  showStudyMarket: () => void
  showCommunity: () => void
  showCourseWorkspace: () => void
}
function createWorkspace(set, get, flush) {
  return {
    surface: 'course',
    showCommunity: () => {
      if (get().surface === 'community') return
      get().notifyLayoutChanged()
      flush()
      set({ surface: 'community', activePanelId: null })
    },
    showCourseWorkspace: () => set({ surface: 'course' }),
  }
}
`
}

test('only complete community wiring narrows scope; mixed, partial, moved and repeated edits stay broad', () => {
  for (const fixture of [communityPreload, communityWorkspace]) {
    const { file, before, after } = fixture
    assert.equal(onlyCommunityRegistrationChanged(file, before, after), true)
    assert.equal(onlyCommunityRegistrationChanged(file, before, after.replaceAll('\n', '\r\n')), true)
    assert.equal(onlyCommunityRegistrationChanged(file, before, after + 'unrelatedMutation()\n'), false)
    assert.equal(onlyCommunityRegistrationChanged(file, before, before), false)
    assert.equal(onlyCommunityRegistrationChanged(file, after, after), false)
    assert.equal(onlyCommunityRegistrationChanged(file, before + before, after + after), false)
  }
  assert.equal(onlyCommunityRegistrationChanged('toString', '', ''), false)
  assert.equal(onlyCommunityRegistrationChanged('src/main/index.ts', communityPreload.before, communityPreload.after), false)
  assert.equal(onlyCommunityRegistrationChanged(communityPreload.file, communityPreload.before, communityPreload.after.replace('assertAppRendererSender(event)', '')), false)
  assert.equal(onlyCommunityRegistrationChanged(communityPreload.file, communityPreload.before, "  'community:open',\n" + communityPreload.before), false)
  assert.equal(onlyCommunityRegistrationChanged(communityWorkspace.file, communityWorkspace.before, communityWorkspace.after.replace('      flush()\n', '')), false)
  assert.equal(onlyCommunityRegistrationChanged(communityWorkspace.file, communityWorkspace.before, communityWorkspace.after.replace("set({ surface: 'course' })", "set({ surface: 'community' })")), false)
})

test('community E2E scoping preserves unrecognized files and fails closed on missing history', () => {
  const files = [communityPreload.file, 'src/main/features/pdf/exportPdf.ts']
  const scoped = communityE2eFiles(files, () => communityPreload.before, () => communityPreload.after)
  assert.deepEqual(files, [communityPreload.file, 'src/main/features/pdf/exportPdf.ts'])
  assert.ok(scoped.includes('src/main/features/pdf/exportPdf.ts'))
  assert.ok(!scoped.includes(communityPreload.file))
  assert.deepEqual(planChecks(scoped).e2e, ['e2e/studyMarket.spec.ts', 'e2e/community.spec.ts', 'e2e/pdfExport.spec.ts'])
  assert.equal(communityE2eFiles(files, () => { throw new Error('missing blob') }, () => communityPreload.after), files)
  assert.equal(communityE2eFiles(files, () => communityPreload.before, () => { throw new Error('deleted file') }), files)
})

test('community backend and navigation select their own packaged regression without appearance suites', () => {
  for (const file of ['supabase/migrations/20261021000000_community.sql', 'tests/backend/community/policy.sql']) {
    const plan = planChecks([file])
    assert.equal(plan.communityBackend, true)
    assert.deepEqual(plan.e2e, ['e2e/community.spec.ts'])
  }
  const plan = planChecks(['src/renderer/src/app/communityNavigation.ts'])
  assert.equal(plan.communityBackend, false)
  assert.deepEqual(plan.e2e, ['e2e/community.spec.ts'])
  assert.ok(!plan.scriptTests.includes('scripts/check-contrast.mjs'))
})

test('CLI scopes only E2E while retaining original type and unit inputs, mixed changes and --full', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bandal-community-scope-'))
  const originalDirectory = process.cwd(), originalLog = console.log
  const write = (file, value) => { mkdirSync(join(directory, file, '..'), { recursive: true }); writeFileSync(join(directory, file), value) }
  try {
    process.chdir(directory)
    execFileSync('git', ['init', '-q'])
    for (const fixture of [communityPreload, communityWorkspace]) write(fixture.file, fixture.before)
    execFileSync('git', ['add', '.'])
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'])
    for (const fixture of [communityPreload, communityWorkspace]) write(fixture.file, fixture.after)
    const plan = (...extra) => {
      let output
      console.log = value => { output = value }
      runAffectedChecks(['--base', 'HEAD', '--plan', ...extra])
      return JSON.parse(output)
    }
    const isolated = plan()
    assert.deepEqual(isolated.e2e, ['e2e/studyMarket.spec.ts', 'e2e/community.spec.ts'])
    assert.deepEqual(isolated.types, ['tsconfig.node.json', 'tsconfig.web.json'])
    for (const fixture of [communityPreload, communityWorkspace]) assert.ok(isolated.unitInputs.includes(fixture.file))
    assert.ok(plan('--full').e2e.includes('e2e/tabs.spec.ts'))
    write(communityWorkspace.file, communityWorkspace.after.replace("set({ surface: 'course' })", "set({ surface: 'community' })"))
    const mixed = plan()
    assert.ok(mixed.e2e.includes('e2e/tabs.spec.ts'))
    assert.ok(mixed.e2e.includes('e2e/coursePerformance.spec.ts'))
    assert.ok(mixed.e2e.includes('e2e/community.spec.ts'))
    assert.ok(mixed.unitInputs.includes(communityWorkspace.file))
  } finally {
    console.log = originalLog
    process.chdir(originalDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})

const publishedRelease = (tag_name, published_at, extra = {}) => ({ tag_name, published_at, draft: false, prerelease: false, ...extra })
test('the CI baseline excludes failed drafts, unpublished/current tags and other branches', () => {
  const releases = [
    publishedRelease('v0.84.1', '2026-10-15T00:00:00Z'), // Current HEAD, outside HEAD^.
    publishedRelease('v0.90.0', '2026-10-16T00:00:00Z'), // Unrelated branch.
    publishedRelease('v0.84.0', '2026-10-14T00:00:00Z', { draft: true }),
    publishedRelease('v0.85.0', '2026-10-14T00:00:00Z', { prerelease: true }),
    publishedRelease('v0.86.0-beta.1', '2026-10-14T00:00:00Z'),
    publishedRelease('v0.83.2', null),
    publishedRelease('v0.82.0', '2026-10-11T00:00:00Z'),
    publishedRelease('v0.83.1', '2026-10-13T00:00:00Z'),
    publishedRelease('v0.83.0', '2026-10-12T00:00:00Z')
  ]
  const ancestors = ['v0.82.0', 'v0.83.0', 'v0.83.1', 'v0.83.2', 'v0.84.0', 'v0.85.0', 'v0.86.0-beta.1']
  assert.equal(publishedReleaseBase(releases, ancestors), 'v0.83.1')
  assert.throws(() => publishedReleaseBase(releases, ['v0.84.0']), /No published stable release/)
  assert.throws(() => publishedReleaseBase([], ancestors), /No published stable release/)
})

test('CI resolves its baseline with a paginated read-only API and local ancestor tags', () => {
  const calls = [], env = { CI: 'true', GITHUB_REPOSITORY: 'example/bandal', GH_TOKEN: 'test-only' }
  const base = resolveCheckBase(undefined, { env, exec: (command, args, options) => {
    calls.push([command, args])
    assert.equal(options.env, env)
    if (command === 'gh') return [
      publishedRelease('v0.84.1', '2026-10-15T00:00:00Z'),
      publishedRelease('v0.84.0', null, { draft: true }),
      publishedRelease('v0.83.1', '2026-10-13T00:00:00Z')
    ].map(release => JSON.stringify(release)).join('\n')
    return 'v0.83.1\nv0.84.0\n'
  } })
  assert.equal(base, 'v0.83.1')
  assert.deepEqual(calls, [
    ['gh', ['api', 'repos/example/bandal/releases?per_page=100', '--paginate', '--jq', '.[] | {tag_name, draft, prerelease, published_at} | tojson']],
    ['git', ['tag', '--merged', 'HEAD^']]
  ])
})

test('explicit bases bypass CI lookup and local runs retain their nearest-tag default', () => {
  assert.equal(resolveCheckBase('explicit-base', { env: { CI: 'true' }, exec: () => { throw new Error('must not fetch') } }), 'explicit-base')
  assert.equal(resolveCheckBase(undefined, { env: {}, exec: (command, args) => {
    assert.equal(command, 'git')
    assert.deepEqual(args, ['describe', '--tags', '--abbrev=0', 'HEAD^'])
    return 'v0.84.0\n'
  } }), 'v0.84.0')
})

test('CI API failures and invalid release responses never fall back to an unverified tag', () => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'example/bandal' }
  const calls = []
  assert.throws(() => resolveCheckBase(undefined, { env, exec: (command) => {
    calls.push(command)
    throw new Error('GitHub API unavailable')
  } }), /GitHub API unavailable/)
  assert.deepEqual(calls, ['gh'])
  assert.throws(() => resolveCheckBase(undefined, { env, exec: () => 'invalid JSON' }), SyntaxError)
  assert.throws(() => resolveCheckBase(undefined, { env, exec: () => '' }), /No published stable release/)
  assert.throws(() => resolveCheckBase(undefined, { env: { CI: 'true' }, exec: () => { throw new Error('must not call') } }), /GITHUB_REPOSITORY is required/)
})

function chatDependencyPromotion() {
  const versions = { katex: '0.18.1', remark: '15.0.1', 'remark-gfm': '4.0.1', 'remark-math': '6.0.0' }
  const before = { version: '0.83.1', scripts: { build: 'electron-vite build' }, dependencies: { electron: '43.4.1' }, devDependencies: { typescript: '5.9.3' } }
  const after = { ...structuredClone(before), version: '0.84.0', devDependencies: { ...before.devDependencies, ...versions } }
  const entries = Object.entries(versions).map(([name, version]) => `      ${name}:\n        specifier: ${version}\n        version: ${version}\n`).join('')
  const packages = Object.entries(versions).map(([name, version]) => `  ${name}@${version}:\n    resolution: {integrity: sha512-existing}\n`).join('\n')
  const snapshots = Object.entries(versions).map(([name, version]) => `  ${name}@${version}:\n    dependencies: {}\n`).join('\n')
  const beforeLock = `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\nimporters:\n\n  .:\n    devDependencies:\n      typescript:\n        specifier: 5.9.3\n        version: 5.9.3\n\npackages:\n\n${packages}\nsnapshots:\n\n${snapshots}`
  const afterLock = beforeLock.replace('      typescript:\n', `${entries}      typescript:\n`)
  return { before, after, beforeLock, afterLock, entries }
}

test('only exact existing locked chat packages may become direct renderer dependencies', () => {
  const f = chatDependencyPromotion()
  const check = (before = f.before, after = f.after, beforeLock = f.beforeLock, afterLock = f.afterLock) => onlyLockedChatDependenciesPromoted(before, after, beforeLock, afterLock)
  assert.equal(check(), true)
  assert.equal(check(f.before, f.after, f.beforeLock, f.afterLock.replaceAll('\n', '\r\n')), true)
  for (const after of [
    { ...f.after, scripts: { build: 'changed-build' } },
    { ...f.after, dependencies: { electron: '44.0.0' } },
    { ...f.after, pnpm: { overrides: { katex: '0.18.1' } } },
    { ...f.after, devDependencies: { ...f.after.devDependencies, katex: '0.18.2' } },
    { ...f.after, devDependencies: { ...f.after.devDependencies, remark: '^15.0.1' } },
    { ...f.after, devDependencies: { ...f.after.devDependencies, '@types/katex': '0.16.8' } }
  ]) assert.equal(check(f.before, after), false)
  for (const afterLock of [
    f.afterLock.replace('autoInstallPeers: true', 'autoInstallPeers: false'),
    f.afterLock.replace('specifier: 15.0.1', 'specifier: ^15.0.1'),
    f.afterLock.replace('version: 15.0.1', 'version: 15.0.2'),
    f.afterLock.replace('version: 5.9.3', 'version: 5.9.4'),
    f.afterLock.replace('sha512-existing', 'sha512-new'),
    f.afterLock.replace('dependencies: {}', 'dependencies: {new: 1.0.0}'),
    f.afterLock.replace('packages:\n', '  other:\n    devDependencies: {}\n\npackages:\n'),
    f.afterLock.replace('    devDependencies:\n', '    dependencies:\n'),
    f.afterLock.replace('      typescript:\n', `${f.entries}      typescript:\n`),
    `${f.afterLock}\n  newly-installed@1.0.0: {}\n`,
    f.beforeLock
  ]) assert.equal(check(f.before, f.after, f.beforeLock, afterLock), false)
  for (const section of ['packages', 'snapshots']) {
    const missing = f.beforeLock.replace(`${section}:`, `${section}-missing:`)
    assert.equal(check(f.before, f.after, missing, missing.replace('      typescript:\n', `${f.entries}      typescript:\n`)), false)
  }
  const missingPackage = f.beforeLock.replaceAll('  katex@0.18.1:', '  katex@0.18.0:')
  assert.equal(check(f.before, f.after, missingPackage, missingPackage.replace('      typescript:\n', `${f.entries}      typescript:\n`)), false)
  assert.equal(check(f.after, f.after, f.afterLock, f.afterLock), false)
  const alreadyDirect = { ...f.before, dependencies: { ...f.before.dependencies, katex: '0.18.1' } }
  assert.equal(check(alreadyDirect, { ...f.after, dependencies: alreadyDirect.dependencies }), false)
  assert.equal(f.before.devDependencies.katex, undefined)
  assert.equal(f.after.devDependencies.katex, '0.18.1')
})

test('changed file classification scopes proven promotions and keeps all other package changes full', () => {
  const f = chatDependencyPromotion(), directory = mkdtempSync(join(tmpdir(), 'bandal-affected-chat-'))
  const originalDirectory = process.cwd()
  const write = (manifest, lock) => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(directory, 'pnpm-lock.yaml'), lock)
  }
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
  try {
    git('init', '-q')
    write(f.before, f.beforeLock)
    git('add', 'package.json', 'pnpm-lock.yaml')
    git('-c', 'user.name=Affected Tests', '-c', 'user.email=tests@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(directory, 'no-hooks')}`, 'commit', '-qm', 'fixture')
    process.chdir(directory)
    write(f.after, f.afterLock)
    const scoped = planChecks(changedFiles('HEAD').files)
    assert.equal(scoped.full, false)
    assert.deepEqual(scoped.types, ['tsconfig.web.json'])
    assert.deepEqual(scoped.unitInputs, ['src/renderer/src/features/chat/markdown.ts', 'src/renderer/src/features/chat/MarkdownView.tsx'])
    assert.ok(scoped.e2e.includes('e2e/chatUx.spec.ts'))
    for (const [manifest, lock] of [
      [{ ...f.after, scripts: { build: 'changed-build' } }, f.afterLock],
      [{ ...f.after, dependencies: { electron: '44.0.0' } }, f.afterLock],
      [f.after, f.afterLock.replace('sha512-existing', 'sha512-new')],
      [f.after, f.afterLock.replace('version: 15.0.1', 'version: 15.0.2')],
      [f.before, f.afterLock]
    ]) {
      write(manifest, lock)
      assert.equal(planChecks(changedFiles('HEAD').files).full, true)
    }
  } finally {
    process.chdir(originalDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})

function pdfDependencyPromotion() {
  const before = { version: '0.85.0', scripts: { build: 'electron-vite build' }, dependencies: { 'cross-spawn': '^7.0.6' }, devDependencies: { 'pdf-lib': '^1.17.1', typescript: '5.9.3' } }
  const after = structuredClone(before)
  after.version = '0.85.1'
  after.dependencies['pdf-lib'] = after.devDependencies['pdf-lib']
  delete after.devDependencies['pdf-lib']
  const entry = '      pdf-lib:\n        specifier: ^1.17.1\n        version: 1.17.1\n'
  const beforeLock = `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\nimporters:\n\n  .:\n    dependencies:\n      cross-spawn:\n        specifier: ^7.0.6\n        version: 7.0.6\n    devDependencies:\n${entry}      typescript:\n        specifier: 5.9.3\n        version: 5.9.3\n\npackages:\n\n  pdf-lib@1.17.1:\n    resolution: {integrity: sha512-existing}\n\nsnapshots:\n\n  pdf-lib@1.17.1:\n    dependencies: {pako: 1.0.11}\n`
  const afterLock = beforeLock.replace(entry, '').replace('    dependencies:\n', `    dependencies:\n${entry}`)
  return { before, after, beforeLock, afterLock, entry }
}

test('only the unchanged locked PDF library can move from development to production', () => {
  const f = pdfDependencyPromotion()
  const check = (before = f.before, after = f.after, beforeLock = f.beforeLock, afterLock = f.afterLock) => onlyLockedPdfDependencyPromoted(before, after, beforeLock, afterLock)
  assert.equal(check(), true)
  assert.equal(check(f.before, f.after, f.beforeLock, f.afterLock.replaceAll('\n', '\r\n')), true)
  for (const after of [
    { ...f.after, scripts: { build: 'changed-build' } },
    { ...f.after, scripts: { ...f.after.scripts, reel: 'new script' } },
    { ...f.after, dependencies: { ...f.after.dependencies, 'pdf-lib': '^1.18.0' } },
    { ...f.after, dependencies: { ...f.after.dependencies, 'pdf-lib': '1.17.1' } },
    { ...f.after, dependencies: { ...f.after.dependencies, other: '1.0.0' } },
    { ...f.after, devDependencies: { ...f.after.devDependencies, typescript: '5.9.4' } },
    { ...f.after, devDependencies: { ...f.after.devDependencies, 'pdf-lib': '^1.17.1' } },
    { ...f.after, optionalDependencies: { 'pdf-lib': '^1.17.1' } },
    { ...f.after, pnpm: { overrides: { pako: '1.0.12' } } }
  ]) assert.equal(check(f.before, after), false)
  for (const afterLock of [
    f.beforeLock,
    f.afterLock.replace('autoInstallPeers: true', 'autoInstallPeers: false'),
    f.afterLock.replace('specifier: ^1.17.1', 'specifier: 1.17.1'),
    f.afterLock.replace('version: 1.17.1', 'version: 1.18.0'),
    f.afterLock.replace('version: 7.0.6', 'version: 7.0.7'),
    f.afterLock.replace('sha512-existing', 'sha512-new'),
    f.afterLock.replace('pako: 1.0.11', 'pako: 1.0.12'),
    f.afterLock.replace('packages:\n', '  other:\n    dependencies: {}\n\npackages:\n'),
    f.afterLock.replace(f.entry, f.entry + f.entry),
    f.afterLock.replace('    devDependencies:\n', `    devDependencies:\n${f.entry}`),
    f.afterLock + '\n  new-package@1.0.0: {}\n'
  ]) assert.equal(check(f.before, f.after, f.beforeLock, afterLock), false)
  for (const section of ['packages', 'snapshots']) {
    assert.equal(check(f.before, f.after, f.beforeLock.replace(`${section}:`, `${section}-missing:`), f.afterLock.replace(`${section}:`, `${section}-missing:`)), false)
  }
  assert.equal(check(f.before, f.after, f.beforeLock.replaceAll('pdf-lib@1.17.1:', 'pdf-lib@1.16.0:'), f.afterLock.replaceAll('pdf-lib@1.17.1:', 'pdf-lib@1.16.0:')), false)
  assert.equal(check({ ...f.before, dependencies: { ...f.before.dependencies, 'pdf-lib': '^1.17.1' } }), false)
  assert.equal(check(f.after, f.before, f.afterLock, f.beforeLock), false)
  assert.equal(check(f.after, f.after, f.afterLock, f.afterLock), false)
})

test('PDF promotion includes every current runtime consumer plus packaged projector and note checks', () => {
  const inputs = pdfDependencyPromotionInputs()
  const expected = [
    'resources/ipad-bridge/projector-host.cjs',
    'src/main/features/canvas/boardMediaPdf.ts',
    'src/main/features/canvas/exportBoardPdf.ts',
    'src/main/features/ipadSync/runtime.ts',
    'src/main/features/pdf/exportPdf.ts',
    'src/main/features/pdf/legacyNoteMigration.ts',
    'src/main/features/pdf/notePaper.ts',
    'src/main/features/pdf/pdfNotes.ts',
    'src/main/features/pdf/pendingPdfMutations.ts',
    'src/main/features/pdfText.ts',
    'src/main/features/presentation/presentationService.ts',
    'src/main/features/studyMarket/bundles.ts',
    'src/main/features/textboxPdfLayout.ts'
  ]
  for (const file of expected) assert.ok(inputs.includes(file), `Missing PDF runtime consumer: ${file}`)
  assert.ok(inputs.includes('resources/ipad-bridge/bridge.py'))
  assert.ok(inputs.includes('tests/main/ipadSync/projectorDurability.test.ts'))
  const plan = planChecks(inputs)
  assert.equal(plan.full, false)
  for (const file of expected.filter(file => file.startsWith('src/'))) assert.ok(plan.unitInputs.includes(file))
  assert.ok(plan.unitInputs.includes('tests/main/ipadSync/projectorDurability.test.ts'))
  for (const spec of ['pdfExport', 'ipadBilling', 'accountNotes', 'accountProfileBackup', 'studyMarket']) assert.ok(plan.e2e.includes(`e2e/${spec}.spec.ts`))
  assert.deepEqual(plan.pythonTests, ['tests/main/ipadSync/test_bridge_billing.py', 'tests/main/ipadSync/test_bridge_scope.py', 'tests/main/ipadSync/test_bridge_cancellation.py', 'tests/main/ipadSync/test_bridge_stdio.py'])
  assert.deepEqual(plan.types, ['tsconfig.node.json'])
  assert.equal(plan.syncAccessBackend, false)
})

test('PDF changed-file classification discovers future consumers and stays full for any unproven package change', () => {
  const f = pdfDependencyPromotion(), directory = mkdtempSync(join(tmpdir(), 'bandal-affected-pdf-'))
  const originalDirectory = process.cwd()
  const write = (manifest, lock) => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(directory, 'pnpm-lock.yaml'), lock)
  }
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
  try {
    git('init', '-q')
    write(f.before, f.beforeLock)
    mkdirSync(join(directory, 'src'), { recursive: true })
    mkdirSync(join(directory, 'resources'), { recursive: true })
    writeFileSync(join(directory, 'src/newPdfConsumer.ts'), "import { PDFDocument } from 'pdf-lib'\n")
    writeFileSync(join(directory, 'resources/newPdfConsumer.cjs'), "const pdf = require('pdf-lib/cjs')\n")
    git('add', '.')
    git('-c', 'user.name=Affected Tests', '-c', 'user.email=tests@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(directory, 'no-hooks')}`, 'commit', '-qm', 'fixture')
    process.chdir(directory)
    write(f.after, f.afterLock)
    const files = changedFiles('HEAD').files
    assert.ok(files.includes('src/newPdfConsumer.ts'))
    assert.ok(files.includes('resources/newPdfConsumer.cjs'))
    assert.ok(files.includes('resources/ipad-bridge/bridge.py'))
    assert.ok(!files.includes('package.json'))
    assert.ok(!files.includes('pnpm-lock.yaml'))
    assert.equal(planChecks(files).full, false)
    for (const [manifest, lock] of [
      [{ ...f.after, scripts: { ...f.after.scripts, reel: 'new script' } }, f.afterLock],
      [{ ...f.after, dependencies: { ...f.after.dependencies, 'pdf-lib': '^1.18.0' } }, f.afterLock],
      [{ ...f.after, dependencies: { ...f.after.dependencies, other: '1.0.0' } }, f.afterLock],
      [f.after, f.afterLock.replace('sha512-existing', 'sha512-new')],
      [f.after, f.afterLock.replace('pako: 1.0.11', 'pako: 1.0.12')],
      [f.after, f.afterLock.replace('version: 7.0.6', 'version: 7.0.7')],
      [f.before, f.afterLock]
    ]) {
      write(manifest, lock)
      assert.equal(planChecks(changedFiles('HEAD').files).full, true)
    }
  } finally {
    process.chdir(originalDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('study market server changes select real integration and related packaged flows', () => {
  for (const file of ['supabase/migrations/20261013000000_study_market.sql', 'supabase/functions/_shared/study-market/service.ts', 'src/shared/types/studyMarket.ts']) {
    const plan = planChecks([file])
    assert.equal(plan.studyMarketBackend, true)
    assert.equal(plan.full, false)
    assert.deepEqual(plan.e2e, ['e2e/studyMarket.spec.ts'])
    assert.ok(plan.unitInputs.includes('tests/backend/studyMarket/policy.test.ts'))
  }
  const ui = planChecks(['src/renderer/src/features/studyMarket/StudyMarketHome.tsx', 'src/renderer/src/app/studyMarketNavigation.ts'])
  assert.equal(ui.studyMarketBackend, false)
  assert.deepEqual(ui.e2e, ['e2e/studyMarket.spec.ts'])
  assert.equal(planChecks(['src/main/features/pdf/exportPdf.ts']).studyMarketBackend, false)
})

test('Paddle billing server changes select their own integration without unrelated desktop flows', () => {
  for (const file of [
    'supabase/migrations/20261013010000_paddle_billing_sandbox.sql',
    'supabase/functions/_shared/paddle-billing/service.ts',
    'supabase/functions/paddle-billing/index.ts',
    'supabase/functions/paddle-webhook/index.ts',
    'supabase/functions/paddle-billing-live/index.ts',
    'supabase/functions/paddle-webhook-live/index.ts',
    'supabase/migrations/20261015010000_paddle_billing_live.sql',
    'tests/backend/paddleBilling/integration.test.ts',
    'tests/backend/paddleBilling/run-local.mjs'
  ]) {
    const plan = planChecks([file])
    assert.equal(plan.paddleBillingBackend, true)
    assert.equal(plan.studyMarketBackend, false)
    assert.equal(plan.full, false)
    assert.deepEqual(plan.types, [])
    assert.deepEqual(plan.e2e, [])
    assert.ok(plan.unitInputs.includes('tests/backend/paddleBilling/policy.test.ts'))
    assert.ok(plan.unitInputs.includes('tests/backend/paddleBilling/service.test.ts'))
    assert.ok(!plan.unitInputs.includes('tests/backend/studyMarket/policy.test.ts'))
  }
  assert.equal(planChecks(['supabase/functions/_shared/study-market/service.ts']).paddleBillingBackend, false)
  assert.equal(planChecks(['src/main/features/pdf/exportPdf.ts']).paddleBillingBackend, false)
})

test('Paddle Deno checks target existing API and webhook entrypoints selected independently', () => {
  assert.deepEqual(PADDLE_BILLING_FUNCTIONS, [
    'supabase/functions/paddle-billing/index.ts',
    'supabase/functions/paddle-webhook/index.ts',
    'supabase/functions/paddle-billing-live/index.ts',
    'supabase/functions/paddle-webhook-live/index.ts'
  ])
  for (const file of PADDLE_BILLING_FUNCTIONS) {
    assert.equal(existsSync(file), true, `Missing Paddle function: ${file}`)
    assert.equal(planChecks([file]).paddleBillingBackend, true)
    assert.equal(planChecks([file]).studyMarketBackend, false)
  }
})

test('iPad billing client changes select safe error handling and the account menu', () => {
  for (const file of ['resources/ipad-bridge/bridge.py', 'src/main/features/ipadSync/runtime.ts', 'tests/main/ipadSync/test_bridge_billing.py']) {
    const plan = planChecks([file])
    const expected = ['tests/main/ipadSync/test_bridge_billing.py']
    if (file.startsWith('resources/')) expected.push('tests/main/ipadSync/test_bridge_scope.py')
    if (!file.startsWith('tests/')) expected.push('tests/main/ipadSync/test_bridge_cancellation.py')
    if (!file.startsWith('tests/')) expected.push('tests/main/ipadSync/test_bridge_stdio.py')
    assert.deepEqual(plan.pythonTests, expected)
    assert.deepEqual(plan.e2e, file.startsWith('tests/') ? ['e2e/ipadBilling.spec.ts'] : ['e2e/ipadBilling.spec.ts', 'e2e/accountNotes.spec.ts', 'e2e/accountProfileBackup.spec.ts'])
    assert.equal(plan.paddleBillingBackend, false)
    assert.equal(plan.syncAccessBackend, false)
  }
  assert.deepEqual(planChecks(['src/main/features/pdf/exportPdf.ts']).pythonTests, [])
  assert.deepEqual(planChecks(['tests/main/ipadSync/test_bridge_cancellation.py']).pythonTests, ['tests/main/ipadSync/test_bridge_cancellation.py'])
  assert.deepEqual(planChecks(['tests/main/ipadSync/test_bridge_stdio.py']).pythonTests, ['tests/main/ipadSync/test_bridge_stdio.py'])
})

test('only isolated Live function declarations narrow shared Supabase configuration scope', () => {
  const before = '[api]\nenabled = true\n'
  const after = before + '\n[functions.paddle-billing-live]\nverify_jwt = false\n\n[functions.paddle-webhook-live]\nverify_jwt = false\n'
  assert.equal(onlyLiveBillingConfigAdded(before, after), true)
  assert.equal(onlyLiveBillingConfigAdded(before, after.replace('enabled = true', 'enabled = false')), false)
  assert.equal(onlyLiveBillingConfigAdded(before, after.replace('verify_jwt = false', 'verify_jwt = true')), false)
  assert.equal(onlyLiveBillingConfigAdded(after, after), false)
})

test('sync access and billing schema changes select SQL and Storage quota checks', () => {
  for (const file of [
    'supabase/migrations/20261015020000_sync_paid_access.sql',
    'supabase/migrations/20261015010000_paddle_billing_live.sql',
    'tests/backend/syncAccess/run-local.mjs',
    'tests/backend/syncAccess/integration.test.ts'
  ]) {
    const plan = planChecks([file])
    assert.equal(plan.syncAccessBackend, true)
    assert.equal(plan.studyMarketBackend, false)
    assert.equal(plan.full, false)
    assert.deepEqual(plan.e2e, [])
  }
  assert.equal(planChecks(['src/main/features/pdf/exportPdf.ts']).syncAccessBackend, false)
})

test('Apple verification and notifications select native-provider units and sync SQL without unrelated app E2E', () => {
  for (const file of [...APPLE_BILLING_FUNCTIONS, 'supabase/functions/_shared/apple-billing/provider.ts', 'supabase/migrations/20261017000000_apple_billing.sql', 'tests/backend/appleBilling/provider.deno.ts']) {
    const plan = planChecks([file])
    assert.equal(plan.appleBillingBackend, true)
    assert.equal(plan.accountDeletionBackend, false)
    assert.equal(plan.syncAccessBackend, true)
    assert.equal(plan.studyMarketBackend, false)
    assert.equal(plan.full, false)
    assert.deepEqual(plan.types, [])
    assert.deepEqual(plan.e2e, [])
    assert.ok(plan.unitInputs.includes('tests/backend/appleBilling/service.test.ts'))
    assert.ok(!plan.unitInputs.some(input => input.endsWith('.deno.ts')))
  }
  for (const file of APPLE_BILLING_FUNCTIONS) assert.equal(existsSync(file), true)
  assert.equal(planChecks(['src/main/features/pdf/exportPdf.ts']).appleBillingBackend, false)
})

test('account deletion selects all-schema cleanup integration and custody tests, while the base schema selects sync', () => {
  for (const file of [...ACCOUNT_DELETION_FUNCTIONS, 'supabase/functions/_shared/account-delete/apple.ts', 'supabase/migrations/20261017010000_account_deletion.sql', 'tests/backend/appleBilling/deletion.test.ts']) {
    const plan = planChecks([file])
    assert.equal(plan.accountDeletionBackend, true)
    assert.equal(plan.appleBillingBackend, false)
    assert.equal(plan.syncAccessBackend, true)
    assert.equal(plan.full, false)
    assert.deepEqual(plan.e2e, [])
    assert.ok(plan.unitInputs.includes('tests/backend/appleBilling/deletion.test.ts'))
  }
  for (const file of ACCOUNT_DELETION_FUNCTIONS) assert.equal(existsSync(file), true)
  assert.equal(planChecks(['supabase/migrations/20261013005000_personal_sync.sql']).syncAccessBackend, true)
  assert.equal(planChecks(['src/main/features/pdf/exportPdf.ts']).accountDeletionBackend, false)
})

test('shared Edge configuration and full checks verify both billing backends', () => {
  for (const file of ['supabase/config.toml', 'supabase/functions/deno.json', 'supabase/functions/deno.lock', 'package.json']) {
    const plan = planChecks([file])
    assert.equal(plan.studyMarketBackend, true)
    assert.equal(plan.paddleBillingBackend, true)
    assert.equal(plan.syncAccessBackend, true)
    assert.equal(plan.appleBillingBackend, true)
    assert.equal(plan.accountDeletionBackend, true)
  }
  assert.equal(planChecks([], true).paddleBillingBackend, true)
})

test('isolated hover worker entry retains focused preview checks without global build scope', () => {
  const entry = "          hoverPreviewHost: resolve(__dirname, 'src/main/features/materials/hoverPreviewHost.ts'),\n"
  const before = 'input: {\n          index: main\n}'
  assert.equal(onlyHoverPreviewEntryChanged(before, before.replace('input: {\n', `input: {\n${entry}`)), true)
  assert.equal(onlyHoverPreviewEntryChanged(before, `${before}\nplugins: changed`), false)
  const plan = planChecks(['src/main/features/materials/hoverPreviewHost.ts', 'src/renderer/src/features/materials/MaterialAffordances.tsx'])
  assert.equal(plan.full, false)
  assert.ok(plan.e2e.includes('e2e/materialPreview.spec.ts'))
  assert.ok(plan.e2e.includes('e2e/materialsDrag.spec.ts'))
  assert.ok(!plan.e2e.includes('e2e/appleCalendar.spec.ts'))
})

test('English guide rendering, persistence and entry points retain first-use packaged coverage', () => {
  for (const name of ['EnglishReadingGuide.tsx', 'englishReadingGuide.css', 'englishReadingGuideState.ts', 'LearningCreateDialog.tsx', 'LearningTab.tsx']) {
    const plan = planChecks([`src/renderer/src/features/learning/${name}`])
    assert.equal(plan.full, false)
    assert.ok(plan.e2e.includes('e2e/englishReadingGuide.spec.ts'))
    assert.ok(!plan.e2e.includes('e2e/browserCompatibility.spec.ts'))
  }
})

test('material views and native source/share changes retain their packaged flows', () => {
  for (const [file, spec] of [
    ['src/renderer/src/features/materials/MaterialViews.tsx', 'materialViews'],
    ['src/renderer/src/features/materials/materialViewPreference.ts', 'materialViews'],
    ['src/main/features/externalSources/library.ts', 'externalSources'],
    ['src/renderer/src/features/materials/ExternalSourcesPanel.tsx', 'externalSources'],
    ['native/photo-picker/main.swift', 'externalSources'],
    ['src/main/features/share/inbox.ts', 'shareImport'],
    ['native/share-extension/ShareViewController.swift', 'shareImport'],
    ['scripts/verify-share-extension.mjs', 'shareImport']
  ]) {
    const plan = planChecks([file])
    assert.equal(plan.full, false, file)
    assert.ok(plan.e2e.includes(`e2e/${spec}.spec.ts`), file)
    assert.ok(!plan.e2e.includes('e2e/appleCalendar.spec.ts'), file)
  }
})

test('isolated registrations narrow scope only when all existing host lines are unchanged', () => {
  const before = 'import existing\nfunction run() {\n  existing()\n}\n'
  const additions = ['import feature', '  feature()']
  const after = 'import feature\nimport existing\nfunction run() {\n  existing()\n  feature()\n}\n'
  assert.equal(onlyAddedLinesChanged(before, after, additions), true)
  assert.equal(onlyAddedLinesChanged(before, after.replaceAll('\n', '\r\n'), additions), true)
  assert.equal(onlyAddedLinesChanged(before, after.replace('existing()', 'changed()'), additions), false)
  assert.equal(onlyAddedLinesChanged(before, after + '  feature()\n', additions), false)
  assert.equal(onlyAddedLinesChanged(after, after, additions), false)
})

test('offline dictionary assets and study palette retain focused packaged coverage', () => {
  for (const file of ['resources/dictionary/en-ko.sqlite', 'scripts/build-dictionary.mjs', 'src/renderer/src/features/study/StudyToolMenu.tsx']) {
    const plan = planChecks([file])
    assert.equal(plan.full, false)
    assert.deepEqual(plan.e2e, ['e2e/readingTools.spec.ts'])
    if (!file.startsWith('src/')) assert.ok(plan.unitInputs.includes('src/main/features/learning/dictionary.ts'))
  }
})

test('browser chrome and password changes retain their packaged interaction checks', () => {
  for (const file of ['src/renderer/src/features/browser/browser.css', 'src/renderer/src/features/assistantPanel/AssistantPanelToggle.tsx']) {
    const plan = planChecks([file])
    assert.ok(plan.e2e.includes('e2e/browserChrome.spec.ts'))
    assert.equal(plan.full, false)
  }
  for (const file of ['src/renderer/src/features/browser/BrowserLoginPrompt.tsx', 'src/renderer/src/features/browser/loginBridge.ts', 'src/main/features/credentials/loginCapture.ts']) {
    const plan = planChecks([file])
    assert.ok(plan.e2e.includes('e2e/browserPasswordPrompt.spec.ts'))
    assert.equal(plan.full, false)
  }
})

test('PDF export changes skip unrelated browser/calendar/performance checks', () => {
  const plan = planChecks(['src/main/features/pdf/exportPdf.ts', 'src/main/features/pdfText.ts', 'src/main/features/canvas/exportBoardPdf.ts'])
  assert.equal(plan.full, false)
  assert.deepEqual(plan.types, ['tsconfig.node.json'])
  assert.deepEqual(plan.e2e, ['e2e/pdfExport.spec.ts'])
  assert.equal(plan.unitInputs.length, 3)
})
test('font resource changes still select tests despite lacking static imports', () => {
  const plan = planChecks(['resources/fonts/NotoSansKR-Regular.otf'])
  assert.equal(plan.unitInputs.length, 2)
  assert.deepEqual(plan.e2e, ['e2e/pdfExport.spec.ts'])
})
test('shared types and runtime dependency changes broaden only their actual scope', () => {
  assert.equal(planChecks(['src/shared/types/drawing.ts']).types.length, 3)
  assert.equal(planChecks(['pnpm-lock.yaml']).full, true)
  assert.equal(planChecks(['docs/release.md']).full, false)
})
test('a modified regression test is explicitly selected', () => {
  const plan = planChecks(['e2e/browserAddress.spec.ts', 'tests/renderer/browser/urlInput.test.ts'])
  assert.deepEqual(plan.e2e, ['e2e/browserAddress.spec.ts'])
  assert.deepEqual(plan.unitInputs, ['tests/renderer/browser/urlInput.test.ts'])
})
test('CI reuse requires the same commit and rejects older success behind a newer run', () => {
  const success = { head_sha: 'exact', event: 'push', run_number: 1, conclusion: 'success' }
  const failure = { ...success, run_number: 2, conclusion: 'failure' }
  assert.equal(matchingRun([{ ...success, head_sha: 'other' }], 'exact'), undefined)
  assert.equal(matchingRun([{ ...success, event: 'pull_request' }], 'exact'), undefined)
  assert.equal(matchingRun([success, failure], 'exact'), failure)
  assert.equal(matchingRun([success], 'exact'), success)
})

test('server and SDK edits retain their related tests instead of becoming no-op checks', () => {
  for (const file of ['server/marketplace/index.ts', 'sdk/cli/index.ts']) {
    const plan = planChecks([file])
    assert.deepEqual(plan.unitInputs, [file])
    assert.deepEqual(plan.types, ['tsconfig.node.json'])
  }
})

test('SDK verification builds its CLI in a clean checkout', () => {
  assert.ok(planChecks(['sdk/cli/index.ts']).scriptTests.includes('scripts/test-plugin-sdk.mjs'))
  assert.deepEqual(scriptTestCommand('scripts/test-plugin-sdk.mjs'), ['pnpm', ['plugin:test']])
  assert.deepEqual(scriptTestCommand('scripts/test-release-assets.mjs'), ['node', ['--test', 'scripts/test-release-assets.mjs']])
})

test('plugin runtime and app sender boundaries retain their packaged regressions', () => {
  for (const file of ['src/main/features/plugins/sandboxHost.ts', 'src/main/pluginHost/runtime.ts', 'src/preload/pluginHost.ts']) {
    const plan = planChecks([file])
    assert.ok(plan.e2e.includes('e2e/pluginSandbox.spec.ts'))
    assert.ok(plan.e2e.includes('e2e/pluginsV2.spec.ts'))
  }
  assert.deepEqual(planChecks(['src/main/ipc/rendererSender.ts']).e2e, ['e2e/ipcSender.spec.ts'])
})


test('login and download changes select compatibility rather than omnibox E2E', () => {
  const plan = planChecks(['src/main/features/browser/downloads.ts', 'src/renderer/src/features/browser/BrowserGuestView.tsx'])
  assert.deepEqual(plan.e2e, ['e2e/browserCompatibility.spec.ts', 'e2e/courseTabMove.spec.ts', 'e2e/tabMoveSessions.spec.ts', 'e2e/courseMovePreview.spec.ts', 'e2e/browserPlacement.spec.ts'])
})

test('AI links and connection fixes select their direct product regressions', () => {
  assert.deepEqual(planChecks(['src/renderer/src/features/ai/aiShortcutModel.ts']).e2e, ['e2e/aiConnections.spec.ts'])
  const runtime = planChecks(['src/main/features/agent/rpcSession.ts'])
  assert.ok(runtime.e2e.includes('e2e/aiConnections.spec.ts'))
  assert.ok(!runtime.e2e.includes('e2e/courseTabMove.spec.ts'))
  const workspace = planChecks(['src/renderer/src/features/workspace/panelContentHost.tsx'])
  assert.ok(workspace.e2e.includes('e2e/courseTabMove.spec.ts'))
  assert.ok(workspace.e2e.includes('e2e/courseMovePreview.spec.ts'))
  assert.ok(!workspace.e2e.includes('e2e/aiConnections.spec.ts'))
})

test('managed CLI login verifies its helper in the actual packaged runtime', () => {
  for (const file of ['loginBrowserBridge', 'loginLauncher']) {
    const plan = planChecks([`src/main/features/agent/${file}.ts`])
    assert.equal(plan.full, false)
    assert.ok(plan.e2e.includes('e2e/loginBrowserBridge.spec.ts'))
    assert.ok(plan.e2e.includes('e2e/aiConnections.spec.ts'))
    assert.ok(!plan.e2e.includes('e2e/browserImport.spec.ts'))
  }
  for (const file of ['AgentConnectionControls.tsx', 'agentConnectionCopy.ts', 'agent-connection.css']) {
    assert.ok(planChecks([`src/renderer/src/features/chat/${file}`]).e2e.includes('e2e/aiConnections.spec.ts'))
  }
  assert.ok(planChecks(['src/renderer/src/features/browser/agentLoginTabs.ts']).e2e.includes('e2e/aiConnections.spec.ts'))
})

test('material rename changes cover moved views without repeating live session checks', () => {
  for (const file of ['MaterialTree', 'MaterialsSidebar']) {
    const plan = planChecks([`src/renderer/src/features/materials/${file}.tsx`])
    assert.ok(plan.e2e.includes('e2e/courseTabMove.spec.ts'))
    assert.ok(!plan.e2e.includes('e2e/tabMoveSessions.spec.ts'))
  }
})

test('atomic file replacement selects the real note save and rename regression', () => {
  const plan = planChecks(['src/main/lib/atomicWrite.ts'])
  assert.deepEqual(plan.e2e, ['e2e/courseTabMove.spec.ts'])
  assert.deepEqual(plan.types, ['tsconfig.node.json'])
  assert.equal(plan.full, false)
})

test('rail account and update controls select their direct interaction regression', () => {
  for (const file of [
    'src/renderer/src/features/account/SidebarAccountEntry.tsx',
    'src/renderer/src/features/account/account.css',
    'src/renderer/src/features/help/help.css',
    'src/renderer/src/features/updates/RailUpdateButton.tsx',
    'src/renderer/src/features/updates/rail-update.css',
    'src/renderer/src/stores/updateStore.ts'
  ]) {
    const plan = planChecks([file])
    assert.deepEqual(plan.e2e, ['e2e/railUx.spec.ts'])
    assert.equal(plan.full, false)
  }
  assert.ok(planChecks(['src/renderer/src/app/GlobalNavigation.tsx']).e2e.includes('e2e/railUx.spec.ts'))
})

test('favorite copies after folder hover retain their navigation regression', () => {
  assert.deepEqual(planChecks(['src/renderer/src/features/courses/FavoritesSection.tsx']).e2e,
    ['e2e/favoritesDrag.spec.ts', 'e2e/courseMovePreview.spec.ts'])
})

test('native image clipboard does not repeat PDF image export checks', () => {
  assert.deepEqual(planChecks(['src/main/features/systemClipboard.ts']).e2e, ['e2e/interactionFixes.spec.ts'])
})
test('PDF buffering runs continuous zoom and drawing geometry, without unrelated textbox editing', () => {
  const plan = planChecks(['src/renderer/src/features/pdf/BufferedPdfCanvas.tsx', 'src/renderer/src/features/pdf/PdfTab.tsx'])
  assert.deepEqual(plan.e2e, ['e2e/pdfTextbox.spec.ts', 'e2e/interactionStability.spec.ts', 'e2e/interactionFixes.spec.ts'])
  assert.match(plan.e2eGrep, /zooming in and back/)
  assert.equal(planChecks(['src/renderer/src/features/ink/InkLayer.tsx']).e2eGrep, null)
})

test('page synchronization helpers retain the actual paired scroll regression', () => {
  for (const file of ['pdfPageNoteSync', 'pageSyncScroll']) {
    const plan = planChecks([`src/renderer/src/features/links/${file}.ts`])
    assert.deepEqual(plan.e2e, ['e2e/interactionStability.spec.ts'])
    assert.equal(plan.full, false)
  }
})

test('image-only note changes skip unrelated toolbar commands', () => {
  assert.deepEqual(planChecks(['src/renderer/src/features/notes/noteImagePlugin.ts']).e2e, ['e2e/interactionFixes.spec.ts'])
})
test('workspace-only changes focus on retained course views rather than rescanning files', () => {
  const plan = planChecks(['src/renderer/src/stores/workspaceStore.ts'])
  assert.match(plan.e2eGrep, /100 course switches/)
  assert.equal(planChecks(['src/main/features/materials/materialsRepo.ts']).e2eGrep, null)
})

test('isolated browser gesture entry does not expand into unrelated checks', async () => {
  const { onlyBrowserGestureEntryChanged } = await import('./affected-checks.mjs')
  const before = "input: {\n          index: resolve(__dirname, 'src/preload/index.ts'),\n}"
  const after = before.replace('input: {', "input: {\n          browserGesture: resolve(__dirname, 'src/preload/browserGesture.ts'),")
  assert.equal(onlyBrowserGestureEntryChanged(before, after), true)
  assert.equal(onlyBrowserGestureEntryChanged(before, after.replaceAll('\n', '\r\n')), true)
  assert.equal(onlyBrowserGestureEntryChanged(before, after.replace('input:', 'output:')), false)
  assert.equal(onlyBrowserGestureEntryChanged(before, after.replace('input:', 'output:').replaceAll('\n', '\r\n')), false)
  const plan = planChecks(['src/preload/browserGesture.ts', 'src/preload/browserSwipe.ts'])
  assert.equal(plan.full, false)
  assert.deepEqual(plan.e2e, ['e2e/browserSwipe.spec.ts'])
  assert.ok(plan.types.includes('tsconfig.web.json'))
})

test('swipe navigation changes select the dedicated packaged input regression', () => {
  const swipe = 'src/main/features/browser/swipeNavigation.ts'
  assert.deepEqual(planChecks([swipe]).e2e, ['e2e/browserSwipe.spec.ts'])
  assert.deepEqual(planChecks(['src/preload/browserSwipeParents.ts']).e2e, ['e2e/browserSwipe.spec.ts'])
  assert.deepEqual(planChecks([swipe, 'src/main/features/browser/hardenWebviews.ts']).e2e,
    ['e2e/browserSwipe.spec.ts', 'e2e/browserCompatibility.spec.ts'])
  assert.ok(planChecks(['pnpm-lock.yaml']).e2e.includes('e2e/browserSwipe.spec.ts'))
})

test('only the native swipe registration hook can narrow native tab E2E', () => {
  const before = 'function install() {\n  installSwipeNavigation(wc)\n  tab.view.setVisible(false)\n}\n'
  const after = before.replace('installSwipeNavigation(wc)', 'installSwipeNavigation(wc, () => !tab.host.isDestroyed() && tab.host.isVisible() && !tab.host.isMinimized() && tab.view.getVisible())')
  assert.equal(onlySwipeRegistrationChanged(before, after), true)
  assert.equal(onlySwipeRegistrationChanged(before.trim(), after), true)
  assert.equal(onlySwipeRegistrationChanged(before, after.replaceAll('\n', '\r\n')), true)
  assert.equal(onlySwipeRegistrationChanged(before, after.replace('setVisible(false)', 'setVisible(true)')), false)
  assert.equal(onlySwipeRegistrationChanged(before, after.replace('install()', 'create()')), false)
  assert.equal(onlySwipeRegistrationChanged(before, after.replace('tab.view.getVisible()', 'tab.view.setBounds({})')), false)
  assert.equal(onlySwipeRegistrationChanged(before, after.replace('tab.view.getVisible())', 'tab.view.getVisible()); moveTab()')), false)
  assert.equal(onlySwipeRegistrationChanged(before, before), false)
})

test('CSS-only appearance edits select the shell regressions without backend checks', () => {
  const plan = planChecks(['src/renderer/src/styles/tokens.css'])
  assert.equal(plan.full, false)
  for (const spec of ['theme', 'sidebars', 'settingsShell', 'uiRedesign']) assert.ok(plan.e2e.includes(`e2e/${spec}.spec.ts`))
  assert.ok(plan.scriptTests.includes('scripts/check-contrast.mjs'))
  assert.ok(plan.unitInputs.includes('src/shared/theme.ts'))
  assert.ok(!plan.e2e.includes('e2e/appleCalendar.spec.ts'))
})

test('launcher entries select context and rail checks without unrelated appearance or calendar suites', () => {
  const feature = planChecks(['src/renderer/src/features/launcher/featureActions.ts', 'src/renderer/src/stores/workflowPacksStore.ts'])
  assert.deepEqual(feature.e2e, ['e2e/featureLauncher.spec.ts', 'e2e/learningManagement.spec.ts', 'e2e/learningNavigation.spec.ts'])
  const shell = planChecks(['src/renderer/src/app/GlobalNavigation.tsx', 'src/renderer/src/app/AppShell.tsx'])
  assert.deepEqual(new Set(shell.e2e), new Set(['e2e/featureLauncher.spec.ts', 'e2e/sidebars.spec.ts', 'e2e/settingsShell.spec.ts', 'e2e/learningManagement.spec.ts', 'e2e/learningNavigation.spec.ts', 'e2e/railUx.spec.ts']))
  assert.ok(!shell.scriptTests.includes('scripts/check-contrast.mjs'))
  assert.deepEqual(planChecks(['src/renderer/src/features/settings/PacksPanel.tsx']).e2e, ['e2e/featureLauncher.spec.ts', 'e2e/pluginCenter.spec.ts'])
  const mixed = planChecks(['src/renderer/src/app/GlobalNavigation.tsx', 'src/renderer/src/styles/tokens.css'])
  assert.ok(mixed.e2e.includes('e2e/theme.spec.ts'))
})

test('board course picker changes check schedules without exercising OS calendar connections', () => {
  const result = planChecks(['src/renderer/src/features/board/BoardPanel.tsx'])
  assert.ok(result.e2e.includes('e2e/taskSchedule.spec.ts'))
  assert.equal(result.e2e.includes('e2e/appleCalendar.spec.ts'), false)
})

test('study workspace classification and AI execution select the learning setup regression', () => {
  for (const file of [
    'src/main/features/courses/coursesRepo.ts',
    'src/main/db/migrations.ts',
    'src/main/features/agent/SessionManager.ts',
    'src/main/features/agent/agentModels.ts',
    'src/main/features/agent/codex/modelCatalog.ts',
    'src/shared/types/course.ts',
    'src/renderer/src/features/courses/CourseSidebar.tsx'
  ]) assert.ok(planChecks([file]).e2e.includes('e2e/learningSpaces.spec.ts'), file)
  const catalog = planChecks(['src/shared/learning/configuration.ts'])
  assert.deepEqual(catalog.e2e, ['e2e/learning.spec.ts', 'e2e/learningSpaces.spec.ts'])
  const settings = planChecks(['src/renderer/src/features/settings/SettingsApp.tsx'])
  assert.ok(settings.e2e.includes('e2e/settingsShell.spec.ts'))
  assert.ok(!settings.e2e.includes('e2e/theme.spec.ts'))
})

test('browser import boundaries select import and compatibility regressions', () => {
  for (const file of [
    'src/main/features/browser/import/crypto.ts',
    'src/main/ipc/browserImportHandlers.ts',
    'src/main/features/credentials/credentialStore.ts',
    'src/shared/types/browserImport.ts',
    'src/shared/types/credentials.ts',
    'src/renderer/src/features/browser/BrowserImportDialog.tsx',
    'src/renderer/src/features/browser/browserImport.css',
    'src/renderer/src/features/browser/browserFavorite.ts',
    'src/renderer/src/features/browser/browserStartPageModel.ts',
    'native/browser-import/main.swift',
    'native/browser-import/Program.cs',
    'scripts/build-browser-import.mjs',
    'scripts/build-native.mjs',
    'scripts/verify-browser-import.mjs'
  ]) {
    const plan = planChecks([file])
    assert.equal(plan.full, false, file)
    assert.deepEqual(new Set(plan.e2e), new Set(['e2e/browserImport.spec.ts', 'e2e/browserCompatibility.spec.ts', ...(file === 'src/shared/types/credentials.ts' ? ['e2e/browserPasswordPrompt.spec.ts'] : [])]), file)
    assert.ok(!plan.scriptTests.includes('scripts/check-contrast.mjs'), file)
  }
})

test('browser settings avoid unrelated global appearance checks', () => {
  for (const file of [
    'src/renderer/src/features/settings/browser/BrowserSettingsPanel.tsx',
    'src/renderer/src/features/settings/browser/browser-settings.css',
    'src/renderer/src/features/settings/SavedLoginsSettings.tsx',
    'src/renderer/src/features/settings/BrowsingDataPanel.tsx'
  ]) {
    const plan = planChecks([file])
    assert.deepEqual(new Set(plan.e2e), new Set(['e2e/browserImport.spec.ts', 'e2e/browserCompatibility.spec.ts', ...(file === 'src/shared/types/credentials.ts' ? ['e2e/browserPasswordPrompt.spec.ts'] : [])]), file)
    assert.ok(!plan.unitInputs.includes('src/shared/theme.ts'), file)
  }
  const mixed = planChecks(['src/renderer/src/features/settings/browser/browser-settings.css', 'src/renderer/src/styles/tokens.css'])
  assert.ok(mixed.e2e.includes('e2e/theme.spec.ts'))
  assert.ok(mixed.e2e.includes('e2e/browserImport.spec.ts'))
  assert.ok(planChecks(['src/renderer/src/features/settings/AppearancePanel.tsx']).e2e.includes('e2e/uiRedesign.spec.ts'))
})

test('workspace styles, state and tab types cover dragging across app surfaces', () => {
  for (const file of ['src/renderer/src/features/workspace/workspace.css', 'src/renderer/src/features/workspace/tabDragSession.ts', 'src/renderer/src/stores/workspaceStore.ts', 'src/shared/tabs.ts']) {
    const plan = planChecks([file])
    const specs = ['tabs', 'tabDrag', 'workspaceLayout', 'workspaceNarrowTabs', 'workspaceCourseDrop', 'favoritesDrag', 'materialsDrag', 'viewportMenus', 'coursePerformance', 'courseTabMove', 'tabMoveSessions', 'courseMovePreview']
    if (file.endsWith('workspaceStore.ts')) specs.push('learningManagement', 'learningNavigation')
    assert.deepEqual(new Set(plan.e2e), new Set(specs.map(spec => `e2e/${spec}.spec.ts`)), file)
    assert.equal(plan.full, false, file)
  }
  const css = planChecks(['src/renderer/src/features/workspace/workspace.css'])
  assert.ok(css.unitInputs.includes('src/renderer/src/features/workspace/tabDragSession.ts'))
})

test('native helper changes retain unit coverage outside the static TS graph', () => {
  const plan = planChecks(['native/browser-import/main.swift', 'scripts/build-native.mjs'])
  assert.deepEqual(plan.unitInputs, ['src/main/features/browser/import/index.ts'])
})

test('only the known browser import dev hook and version are exempt from runtime-wide checks', () => {
  const before = { version: '0.58.0', scripts: { dev: 'node scripts/build-calendar.mjs && electron-vite dev', build: 'electron-vite build' }, dependencies: { electron: '43.4.1' } }
  const after = structuredClone(before)
  after.version = '0.59.0'
  after.scripts.dev = 'node scripts/build-calendar.mjs && node scripts/build-browser-import.mjs && electron-vite dev'
  assert.equal(onlyVersionOrBrowserImportHookChanged(before, after), true)
  assert.equal(onlyVersionOrBrowserImportHookChanged(before, { ...before, version: '0.58.1' }), true)
  assert.equal(before.version, '0.58.0')
  assert.equal(after.scripts.dev.includes('build-browser-import'), true)
  assert.equal(onlyVersionOrBrowserImportHookChanged(before, { ...after, dependencies: { electron: '44.0.0' } }), false)
  assert.equal(onlyVersionOrBrowserImportHookChanged(before, { ...after, scripts: { ...after.scripts, build: 'another-build' } }), false)
  assert.equal(onlyVersionOrBrowserImportHookChanged(before, { ...after, scripts: { ...after.scripts, dev: `${after.scripts.dev} --inspect` } }), false)
  const runtime = planChecks(['package.json'])
  assert.equal(runtime.full, true)
  assert.ok(runtime.e2e.includes('e2e/browserCompatibility.spec.ts'))
  assert.ok(runtime.e2e.includes('e2e/browserImport.spec.ts'))
})

test('AI transport and brand updates select chat/context/orb package checks without unrelated theme tests', () => {
  const plan = planChecks(['src/main/features/agent/rpcSession.ts', 'src/renderer/src/components/BandalMark.tsx'])
  assert.deepEqual(plan.e2e, ['e2e/chatUx.spec.ts', 'e2e/assistantSidebar.spec.ts', 'e2e/aiContext.spec.ts', 'e2e/aiConnections.spec.ts'])
  assert.equal(plan.full, false)
})

test('learning experience changes select their native package regression including CSS and contracts', () => {
  for (const file of [
    'src/main/features/learning/articleExtractor.ts',
    'src/main/features/learning/approvalDialogs.ts',
    'src/main/features/learning/materialSource.ts',
    'src/main/features/workflowPacks/packStore.ts',
    'src/main/ipc/learningHandlers.ts',
    'src/renderer/src/features/learning/LearningTab.tsx',
    'src/renderer/src/features/learning/learning.css',
    'src/shared/types/learning.ts',
    'src/shared/types/workflowPack.ts',
    'src/shared/workflowPacks/builtins.ts',
    'src/shared/ipc/learningContract.ts'
  ]) {
    const plan = planChecks([file])
    assert.equal(plan.full, false, file)
    const expected = ['e2e/learning.spec.ts', 'e2e/learningSpaces.spec.ts']
    if (file.endsWith('/LearningTab.tsx')) expected.unshift('e2e/englishReadingGuide.spec.ts')
    if (file.includes('renderer/src/features/learning/') || file.endsWith('learningHandlers.ts')) expected.push('e2e/learningManagement.spec.ts', 'e2e/learningNavigation.spec.ts')
    assert.deepEqual(plan.e2e, expected, file)
  }
  assert.ok(planChecks(['pnpm-lock.yaml']).e2e.includes('e2e/learning.spec.ts'))
  assert.ok(!planChecks(['src/main/features/materials/materialsRepo.ts']).e2e.includes('e2e/learning.spec.ts'))
})

test('Windows rename recovery verifies learning folder rebinding and material moves', () => {
  for (const file of [
    'src/main/features/materials/renameWithRetry.ts',
    'src/main/features/materials/watcher.ts',
    'src/main/background/materialsWatcher.ts',
    'src/main/background/watcherHost.ts'
  ]) {
    const plan = planChecks([file])
    assert.equal(plan.full, false)
    assert.ok(plan.e2e.includes('e2e/learning.spec.ts'), file)
    assert.ok(plan.e2e.includes('e2e/materialsDrag.spec.ts'), file)
    assert.ok(plan.e2e.includes('e2e/coursePerformance.spec.ts'), file)
  }
})


test('onboarding and plugin management select their own regressions without global appearance checks', () => {
  for (const file of [
    'src/renderer/src/features/settings/PluginsCategoryPanel.tsx',
    'src/renderer/src/features/settings/McpQuickAdd.tsx',
    'src/renderer/src/features/settings/ExtensionsPanel.tsx',
    'src/renderer/src/features/settings/pluginCenterModel.ts',
    'src/renderer/src/features/settings/PluginFeatureMark.tsx',
    'src/renderer/src/features/settings/mcpPresets.ts',
    'src/renderer/src/features/settings/settings-plugins.css',
    'src/renderer/src/features/settings/catalog/CatalogPanel.tsx',
    'src/main/features/mcpRegistry/registryStore.ts'
  ]) {
    const plan = planChecks([file])
    assert.deepEqual(plan.e2e, ['e2e/pluginCenter.spec.ts'], file)
    assert.ok(!plan.scriptTests.includes('scripts/check-contrast.mjs'), file)
  }
  assert.deepEqual(planChecks(['src/renderer/src/features/onboarding/tour/tourStore.ts']).e2e, ['e2e/onboarding.spec.ts'])
  assert.deepEqual(planChecks(['src/renderer/src/features/settings/SettingsPanels.tsx']).e2e, ['e2e/settingsShell.spec.ts', 'e2e/onboarding.spec.ts', 'e2e/aiConnections.spec.ts'])
  assert.deepEqual(planChecks(['src/shared/settingsCategories.ts']).e2e, ['e2e/settingsShell.spec.ts', 'e2e/pluginCenter.spec.ts'])
  const mixed = planChecks(['src/renderer/src/features/settings/settings-plugins.css', 'src/renderer/src/styles/tokens.css'])
  assert.ok(mixed.e2e.includes('e2e/theme.spec.ts'))
  assert.ok(mixed.e2e.includes('e2e/pluginCenter.spec.ts'))
})

test('account entry and PDF note flows keep their focused packaged coverage', () => {
  assert.ok(planChecks(['src/renderer/src/features/account/AccountAccessGate.tsx']).e2e.includes('e2e/accountNotes.spec.ts'))
  for (const file of ['src/renderer/src/features/account/AccountAccessGate.tsx', 'src/main/features/account/profileManager.ts', 'src/main/ipc/workspaceTransition.ts', 'src/renderer/src/features/documents/workspaceTransition.ts', 'src/preload/index.ts', 'src/shared/ipc/events.ts']) assert.ok(planChecks([file]).e2e.includes('e2e/accountProfileBackup.spec.ts'), file)
  assert.ok(planChecks(['src/main/features/pdf/pdfNotes.ts']).e2e.includes('e2e/accountNotes.spec.ts'))
  assert.ok(planChecks(['src/renderer/src/features/pdf/useWhiteboardClipDelivery.ts']).e2e.includes('e2e/pdfClip.spec.ts'))
  assert.deepEqual(planChecks(['resources/ipad-bridge/projector-host.cjs']).pythonTests, ['tests/main/ipadSync/test_bridge_scope.py'])
})
test('Apple administration tools select their boundary checks without broad product tests', () => {
  for (const action of ['readiness', 'register']) {
    for (const file of [`.github/workflows/apple-ipad-${action}.yml`, `scripts/apple-ipad-${action}.mjs`]) {
      const plan = planChecks([file])
      assert.equal(plan.full, false)
      assert.ok(plan.scriptTests.includes(`scripts/test-apple-ipad-${action}.mjs`))
      assert.deepEqual(plan.e2e, ['e2e/startup.spec.ts'])
    }
  }
})

test('shipped projector and its Windows offline check select the portable import regression', () => {
  for (const file of ['scripts/test-projector-roundtrip.cjs', 'resources/ipad-bridge/backend.js', 'resources/ipad-bridge/projector-host.cjs', 'resources/ipad-bridge/bridge.py', '.github/workflows/verify-windows-projector.yml']) {
    assert.ok(planChecks([file]).unitInputs.includes('tests/main/ipadSync/projectorRoundtrip.test.ts'), file)
  }
})

test('manual Windows package verification keeps focused checks', () => {
  const plan = planChecks(['.github/workflows/verify-windows-package.yml'])
  assert.equal(plan.full, false)
  assert.deepEqual(plan.scriptTests, ['scripts/test-affected-checks.mjs'])
  assert.deepEqual(plan.e2e, ['e2e/startup.spec.ts'])
})
