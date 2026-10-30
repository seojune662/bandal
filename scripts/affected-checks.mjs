#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import spawn from 'cross-spawn'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const gitBlob = (base, file) => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' })
export const PADDLE_BILLING_FUNCTIONS = [
  'supabase/functions/paddle-billing/index.ts',
  'supabase/functions/paddle-webhook/index.ts',
  'supabase/functions/paddle-billing-live/index.ts',
  'supabase/functions/paddle-webhook-live/index.ts'
]

export const APPLE_BILLING_FUNCTIONS = ['apple-billing', 'apple-billing-sandbox', 'apple-notifications', 'apple-notifications-sandbox'].map(name => `supabase/functions/${name}/index.ts`)
export const ACCOUNT_DELETION_FUNCTIONS = ['supabase/functions/account-delete/index.ts']

function isPublishedStableRelease(release) {
  return release?.draft === false && release.prerelease === false &&
    typeof release.tag_name === 'string' && /^v\d+\.\d+\.\d+$/.test(release.tag_name) &&
    typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at))
}

function parseReleaseResponse(output, source) {
  try {
    return JSON.parse(output)
  } catch (cause) {
    throw new SyntaxError(`Invalid JSON from GitHub ${source} while selecting the release baseline.`, { cause })
  }
}

function validateRelease(release, source) {
  if (!release || typeof release !== 'object' || Array.isArray(release) ||
      typeof release.tag_name !== 'string' || typeof release.draft !== 'boolean' ||
      typeof release.prerelease !== 'boolean' ||
      (release.published_at !== null && (typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))))) {
    throw new Error(`Invalid release metadata from GitHub ${source} while selecting the release baseline.`)
  }
  return release
}

/** A failed or draft release must not hide changes from the next release's checks. */
export function publishedReleaseBase(releases, ancestorTags) {
  const reachable = new Set(ancestorTags)
  const release = releases.filter(release => isPublishedStableRelease(release) && reachable.has(release.tag_name))
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))[0]
  if (!release) throw new Error('No published stable release is reachable from HEAD^. Specify --base explicitly to select the verification baseline.')
  return release.tag_name
}

export function resolveCheckBase(base, { env = process.env, exec = execFileSync } = {}) {
  if (base !== undefined && base !== null) return base
  const options = { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 }
  if (env.GITHUB_ACTIONS !== 'true' && env.CI !== 'true') {
    return exec('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'], options).trim()
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    throw new Error('GITHUB_REPOSITORY is required to select a published release baseline in CI.')
  }
  // The public latest endpoint avoids release-list pagination in the usual
  // case. A current-HEAD or unrelated release still requires history lookup.
  const endpoint = `repos/${env.GITHUB_REPOSITORY}/releases`
  const latest = validateRelease(parseReleaseResponse(exec('gh', ['api', `${endpoint}/latest`], options), 'latest release'), 'latest release')
  const ancestorTags = exec('git', ['-c', 'color.ui=false', 'tag', '--merged', 'HEAD^', '--format=%(refname:short)'], options).trim().split(/\r?\n/).filter(Boolean)
  if (isPublishedStableRelease(latest) && ancestorTags.includes(latest.tag_name)) return latest.tag_name

  // Parse the API's JSON arrays, not CLI-formatted JSON strings. Never fall
  // back to an unverified local tag when either API response is invalid.
  const pages = parseReleaseResponse(exec('gh', ['api', `${endpoint}?per_page=100`, '--paginate', '--slurp'], options), 'release history')
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error('Invalid release-history pages from GitHub while selecting the release baseline; expected an array of arrays.')
  }
  const releases = pages.flat().map(release => validateRelease(release, 'release history'))
  try {
    return publishedReleaseBase(releases, ancestorTags)
  } catch (cause) {
    throw new Error(`${cause.message} GitHub latest=${JSON.stringify(latest.tag_name)}; pages=${pages.length}; releases=${releases.length}; publishedStable=${releases.filter(isPublishedStableRelease).length}; ancestorTags=${ancestorTags.length}.`, { cause })
  }
}

/** Compare all work since the last published release in CI, or local tag locally. */
export function changedFiles(base) {
  base = resolveCheckBase(base)
  const files = new Set([
    ...git('diff', '--name-only', '-z', base).split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')
  ].filter(Boolean))
  // Version bumps and the isolated import-helper dev hook do not change runtime dependencies.
  if (files.has('package.json')) {
    const before = JSON.parse(git('show', `${base}:package.json`))
    const after = JSON.parse(readFileSync('package.json', 'utf8'))
    if (onlyVersionOrBrowserImportHookChanged(before, after)) {
      files.delete('package.json')
      // Keep this feature covered even when its already-existing helper was not edited.
      if (before.scripts?.dev !== after.scripts?.dev) files.add('scripts/build-browser-import.mjs')
    } else if (files.has('pnpm-lock.yaml') && onlyLockedChatDependenciesPromoted(
      before, after, gitBlob(base, 'pnpm-lock.yaml'), readFileSync('pnpm-lock.yaml', 'utf8')
    )) {
      files.delete('package.json')
      files.delete('pnpm-lock.yaml')
      // These already-locked libraries now have direct renderer imports.
      // Keep their consumers covered even when the promotion is the only edit.
      files.add('src/renderer/src/features/chat/markdown.ts')
      files.add('src/renderer/src/features/chat/MarkdownView.tsx')
    } else if (files.has('pnpm-lock.yaml') && onlyLockedPdfDependencyPromoted(
      before, after, gitBlob(base, 'pnpm-lock.yaml'), readFileSync('pnpm-lock.yaml', 'utf8')
    )) {
      files.delete('package.json')
      files.delete('pnpm-lock.yaml')
      // externalizeDepsPlugin changes each main-process consumer's loading
      // path, and the packaged projector resolves this library from app.asar.
      for (const input of pdfDependencyPromotionInputs()) files.add(input)
    }
  }
  // Isolated entry registrations leave the existing build pipeline intact.
  if (files.has('electron.vite.config.ts')) {
    const before = gitBlob(base, 'electron.vite.config.ts')
    const after = readFileSync('electron.vite.config.ts', 'utf8')
    if (onlyPdfSearchEntryAdded(before, after)) {
      files.delete('electron.vite.config.ts')
      // Utility-process entry points sit outside the TS import graph. Retain
      // worker startup, indexing and packaged search coverage for entry-only edits.
      for (const file of ['pdfSearchHost.ts', 'pdfSearchClient.ts', 'pdfSearchIndexer.ts']) {
        files.add(`src/main/features/search/${file}`)
      }
    } else if (onlyBrowserGestureEntryChanged(before, after) || onlyHoverPreviewEntryChanged(before, after)) files.delete('electron.vite.config.ts')
  }
  for (const [file, additions, inputs] of [
    ['src/renderer/src/app/AppShell.tsx', ["import { ShareImportDialog } from '../features/share/ShareImportDialog'", '      <ShareImportDialog />'], ['src/renderer/src/features/share/ShareImportDialog.tsx']],
    ['scripts/build-native.mjs', ["import shareExtension from './build-share-extension.mjs'", "import photoPicker from './build-photo-picker.mjs'", '  await photoPicker(context)', '  await shareExtension(context)'], ['scripts/build-share-extension.mjs', 'scripts/build-photo-picker.mjs']]
  ]) {
    if (files.has(file) && onlyAddedLinesChanged(gitBlob(base, file), readFileSync(file, 'utf8'), additions)) {
      files.delete(file)
      for (const input of inputs) files.add(input)
    }
  }
  if (files.has('supabase/config.toml') && onlyLiveBillingConfigAdded(gitBlob(base, 'supabase/config.toml'), readFileSync('supabase/config.toml', 'utf8'))) {
    files.delete('supabase/config.toml')
    for (const entry of PADDLE_BILLING_FUNCTIONS) files.add(entry)
  }
  return { base, files: [...files] }
}

/** Exact isolated feature registrations retain their feature tests without changing existing hosts. */
export function onlyAddedLinesChanged(before, after, additions) {
  const previous = before.replaceAll('\r\n', '\n')
  let next = after.replaceAll('\r\n', '\n')
  for (const line of additions) {
    if (previous.split('\n').includes(line) || next.split('\n').filter(value => value === line).length !== 1) return false
    next = next.replace(`${line}\n`, '')
  }
  return previous === next
}

// Exact feature registrations and retired sell-menu removals. Each accepted
// file must equal this transformation byte for byte outside normalized CRLF.
// Changes to existing host behavior retain the ordinary broad E2E selection.
const COMMUNITY_REGISTRATION_EDITS = {
  "src/main/ipc/registerHandlers.ts": [
    ["import { registerStudyMarketHandlers } from './studyMarketHandlers'\n", "import { registerStudyMarketHandlers } from './studyMarketHandlers'\nimport { createCommunityClient } from '../features/community/client'\nimport { parseCommunityDeepLink, type CommunityDeepLink } from '../features/community/deepLink'\nimport { registerCommunityHandlers } from './communityHandlers'\n"],
    ["export function registerHandlers(deps: RegisterHandlersDeps): IpcRouter {\n", "export function registerHandlers(deps: RegisterHandlersDeps): IpcRouter {\n  let pendingCommunityIntent: CommunityDeepLink | null = null\n  handle('community:takeIntent', () => {\n    const intent = pendingCommunityIntent\n    pendingCommunityIntent = null\n    return intent\n  })\n"],
    ["  const studyMarketClient = createStudyMarketClient({ getClient: () => account.getClient(), fetch: (url, init) => net.fetch(url instanceof URL ? url.href : url, init) })\n", "  const studyMarketClient = createStudyMarketClient({ getClient: () => account.getClient(), fetch: (url, init) => net.fetch(url instanceof URL ? url.href : url, init) })\n  registerCommunityHandlers(handle, { client: createCommunityClient({ getClient: () => account.getClient() }) })\n"],
    ["    handleDeepLink(url) {\n", "    handleDeepLink(url) {\n      const communityIntent = parseCommunityDeepLink(url)\n      if (communityIntent) {\n        pendingCommunityIntent = communityIntent\n        revealMainWindow(createMainWindow())\n        broadcast('community:open', {})\n        return\n      }\n"],
  ],
  "src/preload/index.ts": [
    ["const PUSH_CHANNELS = [\n", "const PUSH_CHANNELS = [\n  'community:open',\n"],
  ],
  "src/shared/ipc/contract.ts": [
    ["import { STUDY_MARKET_CHANNELS, type StudyMarketIpcContract } from './studyMarketContract'\n", "import { STUDY_MARKET_CHANNELS, type StudyMarketIpcContract } from './studyMarketContract'\nimport { COMMUNITY_CHANNELS, type CommunityIpcContract } from './communityContract'\n"],
    ["\nexport interface IpcContract extends StudyMarketIpcContract, MailIpcContract, PresentationIpcContract, RecordingIpcContract, LearningIpcContract {\n", "\nexport interface IpcContract extends CommunityIpcContract, StudyMarketIpcContract, MailIpcContract, PresentationIpcContract, RecordingIpcContract, LearningIpcContract {\n"],
    ["  ...STUDY_MARKET_CHANNELS,\n", "  ...STUDY_MARKET_CHANNELS,\n  ...COMMUNITY_CHANNELS,\n"],
  ],
  "src/shared/ipc/events.ts": [
    ["export interface PushEvents {\n", "export interface PushEvents {\n  'community:open': Record<string, never>\n"],
  ],
  "src/renderer/src/app/AppShell.tsx": [
    ["import { openStudyMarket } from './studyMarketNavigation'\n", "import { openStudyMarket } from './studyMarketNavigation'\nimport { openCommunity } from './communityNavigation'\nimport { CommunityPromotion } from '../features/community/CommunityPromotion'\n"],
    ["  const activeTabKind = useWorkspaceStore((state) => state.activePanelSource()?.descriptor.kind ?? null)\n  const courseRailVisible = courseRailOpen && workspaceSurface !== 'study-market'\n", "  const activeTabKind = useWorkspaceStore((state) => state.activePanelSource()?.descriptor.kind ?? null)\n  const courseRailVisible = courseRailOpen && workspaceSurface !== 'study-market' && workspaceSurface !== 'community'\n"],
    ["  useUpdateNotifications()\n", "  useUpdateNotifications()\n  useEffect(() => {\n    const consume = (): void => {\n      void invoke('community:takeIntent', {}).then(intent => {\n        if (intent) openCommunity(intent)\n      }).catch(() => {})\n    }\n    const off = onPush('community:open', consume)\n    consume()\n    return off\n  }, [])\n"],
    ["      <ShareImportDialog />\n", "      <ShareImportDialog />\n      {!isOnboardingVisible && !settingsPresent && <CommunityPromotion />}\n"],
  ],
  "src/renderer/src/app/GlobalNavigation.tsx": [
    ["import { openStudyMarket } from './studyMarketNavigation'\n", "import { openCommunity } from './communityNavigation'\n"],
    ["        <button className=\"rail-nav__item\" aria-label=\"도구\"\n          aria-expanded={surface !== 'study-market' && courseOpen && leftPanel === 'plugins' && !boardOpen && !settingsOpen && !graphOpen}\n", "        <button className=\"rail-nav__item\" aria-label=\"도구\"\n          aria-expanded={surface !== 'study-market' && surface !== 'community' && courseOpen && leftPanel === 'plugins' && !boardOpen && !settingsOpen && !graphOpen}\n"],
    ["          aria-controls=\"plugins-panel\"\n          data-active={surface !== 'study-market' && courseOpen && leftPanel === 'plugins' && !boardOpen && !settingsOpen && !graphOpen || undefined}\n", "          aria-controls=\"plugins-panel\"\n          data-active={surface !== 'study-market' && surface !== 'community' && courseOpen && leftPanel === 'plugins' && !boardOpen && !settingsOpen && !graphOpen || undefined}\n"],
    ["          onClick={event => {\n            if (surface === 'study-market') {\n", "          onClick={event => {\n            if (surface === 'study-market' || surface === 'community') {\n"],
    ["      </Tooltip>\n      <Tooltip label=\"마켓플레이스\" placement=\"right\">\n        <button className=\"rail-nav__item\" aria-label=\"마켓플레이스\" aria-pressed={surface === 'study-market' && !boardOpen && !settingsOpen && !graphOpen}\n          data-active={surface === 'study-market' && !boardOpen && !settingsOpen && !graphOpen || undefined} onClick={openStudyMarket}>\n          <svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" width=\"1em\" height=\"1em\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"1.75\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M4 10v10h16V10M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6\" /></svg>\n", "      </Tooltip>\n      <Tooltip label=\"커뮤니티\" placement=\"right\">\n        <button className=\"rail-nav__item\" aria-label=\"커뮤니티\" aria-pressed={surface === 'community' && !boardOpen && !settingsOpen && !graphOpen}\n          data-active={surface === 'community' && !boardOpen && !settingsOpen && !graphOpen || undefined} onClick={() => openCommunity()}>\n          <svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" width=\"1em\" height=\"1em\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"1.75\" strokeLinecap=\"round\" strokeLinejoin=\"round\"><path d=\"M21 11a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 1 1 18-4Z\" /><path d=\"M8 10h8M8 14h5\" /></svg>\n"],
  ],
  "src/renderer/src/features/workspace/WorkspaceHost.tsx": [
    ["const StudyMarketHome = lazy(() => import('../studyMarket/StudyMarketHome'))\n", "const StudyMarketHome = lazy(() => import('../studyMarket/StudyMarketHome'))\nconst CommunityHome = lazy(() => import('../community/CommunityHome'))\n"],
    ["    const focus = (): boolean => {\n      const heading = hostRef.current?.querySelector<HTMLElement>(surface === 'study-market' ? '.study-market h1' : '.learning-global-home h1')\n", "    const focus = (): boolean => {\n      const heading = hostRef.current?.querySelector<HTMLElement>(surface === 'community' ? '.community h1' : surface === 'study-market' ? '.study-market h1' : '.learning-global-home h1')\n"],
    ["    {surface === 'learning-home' && <LearningHome />}\n", "    {surface === 'learning-home' && <LearningHome />}\n    {surface === 'community' && <Suspense fallback={<div role=\"status\">커뮤니티 불러오는 중…</div>}><CommunityHome /></Suspense>}\n"],
  ],
  "src/renderer/src/stores/workspaceStore.ts": [
    ["export type WorkspaceHydration = 'idle' | 'loading' | 'ready' | 'error'\nexport type WorkspaceSurface = 'course' | 'learning-home' | 'study-market'\n", "export type WorkspaceHydration = 'idle' | 'loading' | 'ready' | 'error'\nexport type WorkspaceSurface = 'course' | 'learning-home' | 'study-market' | 'community'\n"],
    ["  showStudyMarket: () => void\n", "  showStudyMarket: () => void\n  showCommunity: () => void\n"],
    ["  return {\n    surface: 'course',\n", "  return {\n    surface: 'course',\n    showCommunity: () => {\n      if (get().surface === 'community') return\n      get().notifyLayoutChanged()\n      flush()\n      set({ surface: 'community', activePanelId: null })\n    },\n"],
  ],
  "src/renderer/src/features/courses/CourseSidebar.tsx": [
    ["import { CourseListItem } from './CourseListItem'\nimport { openStudyMarketSell } from '../studyMarket/controller'\n", "import { CourseListItem } from './CourseListItem'\n"],
    ["            role=\"menuitem\"\n            disabled={contextMenu.course.missing}\n            onClick={() => {\n              openStudyMarketSell({ courseId: contextMenu.course.id })\n              setContextMenu(null)\n            }}\n          >\n            <Icon name=\"fileText\" />\n            자료 판매하기\n          </button>\n          <button\n            type=\"button\"\n            role=\"menuitem\"\n", "            role=\"menuitem\"\n"],
  ],
  "src/renderer/src/features/materials/MaterialsContextMenu.tsx": [
    ["import { convertPresentationToPdf } from '../file/pptx/presentationJobs'\nimport { openStudyMarketSell } from '../studyMarket/controller'\nimport { isSellableMaterial } from '../studyMarket/presentation'\n", "import { convertPresentationToPdf } from '../file/pptx/presentationJobs'\n"],
    ["      />\n      {activeCourseId !== null && (target === null || target.kind === 'dir' || isSellableMaterial(target.relPath)) && (\n        <button type=\"button\" role=\"menuitem\" onClick={() => {\n          openStudyMarketSell({ courseId: activeCourseId, ...(target === null ? {} : { relPath: target.relPath }) })\n          onClose()\n        }}><Icon name=\"fileText\" />자료 판매하기</button>\n      )}\n", "      />\n"],
  ],
  "src/renderer/src/features/agent/workspaceSync.ts": [
    ["export interface WorkspaceSyncSources {\n  surface?: 'course' | 'learning-home' | 'study-market'\n", "export interface WorkspaceSyncSources {\n  surface?: 'course' | 'learning-home' | 'study-market' | 'community'\n"],
  ],
  "src/renderer/src/features/assistantPanel/assistantController.ts": [
    ["  const workspace = useWorkspaceStore.getState()\n  if (workspace.surface === 'study-market') {\n", "  const workspace = useWorkspaceStore.getState()\n  if (workspace.surface === 'study-market' || workspace.surface === 'community') {\n"],
  ],
  "src/renderer/src/features/onboarding/tour/tourStore.ts": [
    ["  else if (previous.surface === 'study-market') workspace.showStudyMarket()\n", "  else if (previous.surface === 'study-market') workspace.showStudyMarket()\n  else if (previous.surface === 'community') workspace.showCommunity()\n"],
  ],
}

export function onlyCommunityRegistrationChanged(file, before, after) {
  if (!Object.hasOwn(COMMUNITY_REGISTRATION_EDITS, file)) return false
  const edits = COMMUNITY_REGISTRATION_EDITS[file]
  if (!edits || typeof before !== 'string' || typeof after !== 'string') return false
  let expected = before.replaceAll('\r\n', '\n')
  const next = after.replaceAll('\r\n', '\n')
  if (expected === next) return false
  for (const [previous, replacement] of edits) {
    if (expected.split(previous).length !== 2) return false
    expected = expected.replace(previous, () => replacement)
  }
  return expected === next
}

/** Only E2E inputs are scoped; type and related-unit checks keep every real file. */
export function communityE2eFiles(files, readBefore, readAfter) {
  const isolated = new Set(files.filter(file => {
    if (!Object.hasOwn(COMMUNITY_REGISTRATION_EDITS, file)) return false
    try { return onlyCommunityRegistrationChanged(file, readBefore(file), readAfter(file)) }
    catch { return false } // Missing history, deletes and unreadable files remain broad.
  }))
  if (isolated.size === 0) return files
  return [...new Set(files.filter(file => !isolated.has(file)).concat(
    'src/renderer/src/features/community/CommunityHome.tsx',
    'src/renderer/src/features/studyMarket/StudyMarketHome.tsx'
  ))]
}

// Named input/menu entry points select their functional E2E coverage. Their
// bodies may change; every declaration/import outside those scopes must stay
// unchanged, otherwise the ordinary broader selection applies. Related-unit
// inputs and type checks always retain the original files.
const TAB_PICKER_SCOPES = {
  'src/main/features/browser/hardenWebviews.ts': {
    names: ['attachGuestInput'],
    imports: [], required: ['attachGuestInput'],
    e2e: ['newTabCycle', 'browserPlacement']
  },
  'src/renderer/src/app/shortcuts.ts': {
    names: ['useGlobalShortcuts'], imports: ['NEW_TAB_CYCLE_ACTIONS', 'useNewTabMenu', 'createDefaultNoteTab'],
    required: ['useGlobalShortcuts'], e2e: ['newTabCycle', 'tabs', 'courseTabMove', 'browserPlacement']
  },
  'src/renderer/src/app/tabCommands.ts': {
    names: ['createDefaultNoteTab'], imports: [], required: [], e2e: ['newTabCycle', 'accountNotes']
  },
  'src/renderer/src/features/workspace/NewTabMenu.tsx': {
    names: ['NewTabMenu'], imports: ['NEW_TAB_CYCLE_ACTIONS'], required: ['NewTabMenu'],
    e2e: ['newTabCycle', 'tabs', 'viewportMenus']
  },
  'src/renderer/src/features/workspace/newTabMenuController.ts': {
    names: ['NewTabMenuState', 'NEW_TAB_CYCLE_ACTIONS', 'useNewTabMenu', 'openNewTabMenu'],
    imports: [], required: ['NewTabMenuState', 'useNewTabMenu', 'openNewTabMenu'],
    e2e: ['newTabCycle', 'tabs', 'viewportMenus']
  }
}

function tabPickerRemainder(file, text, scope) {
  if (file.endsWith('/newTabMenuController.ts')) text = text.replace(/^\/\*\*[\s\S]*?\*\//, '')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  if (source.parseDiagnostics.length) return null
  const edits = [], counts = new Map()
  for (const statement of source.statements) {
    const name = ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
      ? statement.declarationList.declarations[0].name.getText(source)
      : statement.name?.getText(source)
    if (scope.names.includes(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
      edits.push([statement.getFullStart(), statement.end, ''])
    } else if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      const clause = statement.importClause, bindings = clause.namedBindings
      const elements = bindings.elements.filter(element => !scope.imports.includes(element.name.text) || element.propertyName !== undefined)
      // Canonicalize both sides of these imports; all unlisted members and
      // the module path remain part of the unchanged-remainder comparison.
      const updated = ts.factory.updateImportDeclaration(statement, statement.modifiers,
        ts.factory.updateImportClause(clause, clause.isTypeOnly, clause.name,
          ts.factory.updateNamedImports(bindings, elements)), statement.moduleSpecifier, statement.attributes)
      edits.push([statement.getStart(source), statement.end, ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, updated, source)])
    }
  }
  if (scope.required.some(name => counts.get(name) !== 1) || [...counts.values()].some(count => count !== 1)) return null
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + replacement + text.slice(end)
  return text
}

export function onlyTabPickerChanged(file, before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return false
  before = before.replaceAll('\r\n', '\n'); after = after.replaceAll('\r\n', '\n')
  if (before === after) return false
  if (Object.hasOwn(TAB_PICKER_SCOPES, file)) {
    const scope = TAB_PICKER_SCOPES[file]
    const previous = tabPickerRemainder(file, before, scope), next = tabPickerRemainder(file, after, scope)
    return previous !== null && next !== null && previous === next
  }
  if (file === 'src/renderer/src/app/app-shell.css') {
    const block = ".app-shell[data-left-panel='courses'] > .shell-course-rail {\n  grid-row: 1 / -1;\n}\n"
    return before.split(block).length === 2 && before.replace(block, '') === after
  }
  if (file === 'src/renderer/src/features/workspace/workspace.css') {
    const block = '.new-tab-menu__cycle-hint {\n  padding: var(--space-3);\n  color: var(--text-secondary);\n  font-size: var(--text-sm);\n}\n\n'
    return after.split(block).length === 2 && after.replace(block, '') === before
  }
  if (file === 'src/renderer/src/features/settings/TabsSettingsPanel.tsx') {
    const scope = { names: ['TABS'], imports: [], required: ['TABS'] }
    const previous = tabPickerRemainder(file, before, scope)
    const next = tabPickerRemainder(file, after.replace("useState<TabId>('browser')", "useState<TabId>('whiteboard')"), scope)
    return previous !== null && next !== null && previous === next
  }
  return false
}

export function tabPickerE2eFiles(files, readBefore, readAfter) {
  const isolated = new Set(files.filter(file => {
    if (!Object.hasOwn(TAB_PICKER_SCOPES, file) && ![
      'src/renderer/src/app/app-shell.css',
      'src/renderer/src/features/workspace/workspace.css', 'src/renderer/src/features/settings/TabsSettingsPanel.tsx'
    ].includes(file)) return false
    try { return onlyTabPickerChanged(file, readBefore(file), readAfter(file)) }
    catch { return false }
  }))
  if (isolated.size === 0) return files
  const specs = [...isolated].flatMap(file => TAB_PICKER_SCOPES[file]?.e2e ?? (
    file.endsWith('/app-shell.css') ? ['sidebars', 'browserPlacement'] : ['newTabCycle', 'tabs', 'viewportMenus']
  )).map(name => `e2e/${name}.spec.ts`)
  return [...new Set(files.filter(file => !isolated.has(file)).concat(specs))]
}

// These files own only the named material/tab affordance. Shared hosts below
// are narrowed only when the rest of their source remains unchanged.
const MATERIAL_CHROME_FILES = {
  'src/main/features/browser/favicon.ts': ['browserFavicons'],
  'src/main/features/materials/exportMaterial.ts': ['materialToolbar', 'materialShare', 'pdfExport'],
  'src/renderer/src/features/materials/MaterialExportButton.tsx': ['materialToolbar', 'materialShare', 'pdfExport'],
  'src/renderer/src/features/materials/materialExport.css': ['materialToolbar'],
  'src/renderer/src/features/file/FileToolbarActions.tsx': ['materialToolbar']
}

const MATERIAL_CHROME_EDITS = {
  'src/renderer/src/features/pdf/tools/PdfToolRail.tsx': [
    ['  interactive?: boolean\n', '  interactive?: boolean\n  showExport?: boolean\n'],
    ['  interactive = true,\n', '  interactive = true,\n  showExport = true,\n'],
    ['        <button\n          type="button"\n          className="pdf-tool-rail__button pdf-tool-rail__export"', '        {showExport && <button\n          type="button"\n          className="pdf-tool-rail__button pdf-tool-rail__export"'],
    ['          <PdfToolIcon name="export" />\n        </button>', '          <PdfToolIcon name="export" />\n        </button>}']
  ],
  'src/renderer/src/features/pdf/pdf.css': [
    ['  .pdf-toolbar__preview-toggle,\n', '  .pdf-toolbar .material-export-button__label,\n  .pdf-toolbar .tab-assistant-toggle__label {\n    display: none;\n  }\n\n  .pdf-toolbar .material-export-button {\n    width: var(--control-height);\n    padding-inline: 0;\n  }\n\n  .pdf-toolbar__preview-toggle,\n']
  ],
  'src/renderer/src/features/browser/BrowserGuestView.tsx': [
    ['favicon.navigation()', 'favicon.navigation(event.url)'],
    ["// Chromium lists every declared icon; the last is the best match.\n          favicon.update(event.favicons.at(-1))", "// Keep raster alternatives when the preferred icon is unsupported\n          // (for example SVG), missing, or blocked by the site's server.\n          favicon.update(event.favicons)"]
  ],
  'src/renderer/src/features/assistantPanel/TabAssistantPanel.tsx': [
    ["import { AssistantPanelToggle } from './AssistantPanelToggle'\n", "import { AssistantPanelToggle } from './AssistantPanelToggle'\nimport type { TabKind } from '../../../../shared/tabs'\nconst TOOLBAR_ASSISTANT_KINDS = new Set<TabKind>(['browser', 'note', 'pdf', 'whiteboard', 'image', 'file', 'recording'])\n"],
    ["descriptor?.kind !== 'browser' && <div className=\"tab-assistant-launchbar\">", "(!descriptor || !TOOLBAR_ASSISTANT_KINDS.has(descriptor.kind)) && <div className=\"tab-assistant-launchbar\">"]
  ]
}
const MATERIAL_CHROME_HOSTS = new Set([...Object.keys(MATERIAL_CHROME_EDITS),
  'src/main/ipc/registerHandlers.ts', 'src/shared/ipc/contract.ts',
  'src/main/features/agentTools/coverage.ts',
  'src/renderer/src/features/pdf/PdfToolbar.tsx',
  'src/renderer/src/features/browser/browserTabEvents.ts',
  'src/renderer/src/features/workspace/adaptive-tabs.css',
  'src/renderer/src/features/assistantPanel/AssistantPanelToggle.tsx'
])

const MATERIAL_SHARE_CHANNELS = new Set(['materials:export', 'canvas:sharePdf', 'recordings:shareTranscript'])
function materialHostRemainder(file, text) {
  const main = file === 'src/main/ipc/registerHandlers.ts'
  const contract = file === 'src/shared/ipc/contract.ts'
  const coverage = file === 'src/main/features/agentTools/coverage.ts'
  const toolbar = file === 'src/renderer/src/features/pdf/PdfToolbar.tsx'
  if (main) text = text.replace('createFaviconFetcher({ fetch: (url) => ensureProfileSession(profileId, req.isPrivate).fetch(url) })',
    'createFaviconFetcher({ fetch: (url, options) => ensureProfileSession(profileId, req.isPrivate).fetch(url, options) })')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  if (source.parseDiagnostics.length) return null
  const imports = main ? {
    '../features/materials/exportMaterial': ['exportMaterial', 'shareGeneratedMaterial']
  } : toolbar ? {
    '../assistantPanel/AssistantPanelToggle': ['AssistantPanelToggle'],
    '../materials/MaterialExportButton': ['MaterialExportButton'],
    '../documents/saveRegistry': ['flushDocumentSaves'], '../../lib/ipc': ['invoke']
  } : {}
  const counts = new Map()
  const record = key => counts.set(key, (counts.get(key) ?? 0) + 1)
  const transformed = ts.transform(source, [context => {
    const visit = node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && Object.hasOwn(imports, node.moduleSpecifier.text) &&
        node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        const clause = node.importClause
        const elements = clause.namedBindings.elements.filter(element => element.propertyName || !imports[node.moduleSpecifier.text].includes(element.name.text))
        if (!elements.length && !clause.name) return undefined
        return ts.factory.updateImportDeclaration(node, node.modifiers, ts.factory.updateImportClause(clause, clause.isTypeOnly,
          clause.name, ts.factory.updateNamedImports(clause.namedBindings, elements)), node.moduleSpecifier, node.attributes)
      }
      if (main && ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
        const call = node.expression, channel = call.arguments[0]
        if (ts.isIdentifier(call.expression) && call.expression.text === 'handle' && channel && ts.isStringLiteral(channel) && MATERIAL_SHARE_CHANNELS.has(channel.text)) {
          record(channel.text); return undefined
        }
      }
      if (contract && ts.isPropertySignature(node) && ts.isStringLiteral(node.name) && MATERIAL_SHARE_CHANNELS.has(node.name.text) &&
        ts.isInterfaceDeclaration(node.parent) && node.parent.name.text === 'IpcContract') {
        record(`type:${node.name.text}`); return undefined
      }
      if (contract && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'IPC_CHANNELS' && node.initializer) {
        const update = expression => {
          if (ts.isAsExpression(expression)) return ts.factory.updateAsExpression(expression, update(expression.expression), expression.type)
          if (ts.isSatisfiesExpression(expression)) return ts.factory.updateSatisfiesExpression(expression, update(expression.expression), expression.type)
          if (!ts.isArrayLiteralExpression(expression)) return expression
          const elements = expression.elements.filter(element => {
            if (!ts.isStringLiteral(element) || !MATERIAL_SHARE_CHANNELS.has(element.text)) return true
            record(`channel:${element.text}`); return false
          })
          return ts.factory.updateArrayLiteralExpression(expression, elements)
        }
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, update(node.initializer))
      }
      if (coverage && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'NOT_FOR_AGENT' &&
        node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        const properties = node.initializer.properties.filter(property => {
          if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) ||
            !MATERIAL_SHARE_CHANNELS.has(property.name.text) || !ts.isStringLiteral(property.initializer)) return true
          record(property.name.text); return false
        })
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ts.factory.updateObjectLiteralExpression(node.initializer, properties))
      }
      if (toolbar && ts.isJsxSelfClosingElement(node)) {
        if (['MaterialExportButton', 'AssistantPanelToggle'].includes(node.tagName.getText(source))) return undefined
        if (node.tagName.getText(source) === 'PdfToolRail') return ts.factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments,
          ts.factory.updateJsxAttributes(node.attributes, node.attributes.properties.filter(property =>
            !ts.isJsxAttribute(property) || !['beforeExport', 'showExport'].includes(property.name.getText(source)))))
      }
      if (toolbar && ts.isJsxText(node) && node.text.trim() === '') return undefined
      return ts.visitEachChild(node, visit, context)
    }
    return node => ts.visitNode(node, visit)
  }])
  try {
    return [...counts.values()].some(count => count > 1) ? null : ts.createPrinter({ removeComments: true }).printFile(transformed.transformed[0])
  } finally { transformed.dispose() }
}

function exactSourceEdits(before, after, edits) {
  let expected = before
  for (const [previous, replacement] of edits) {
    if (expected.split(previous).length !== 2) return false
    expected = expected.replace(previous, () => replacement)
  }
  return expected === after
}

function tabCloseStyleRemainder(text) {
  const allowed = new Map([
    [".bandal-dockview .dv-tabs-container:not([data-tab-density='regular']) .workspace-tab", ['position']],
    [".bandal-dockview .dv-tabs-container:not([data-tab-density='regular']) .workspace-tab__close", ['display', 'position', 'left', 'top', 'width', 'height', 'margin-top', 'opacity', 'pointer-events', 'transform']],
    [".bandal-dockview .dv-tabs-container:not([data-tab-density='regular']) .dv-tab:is(:hover, :focus-within) .workspace-tab__kind", ['visibility']],
    [".bandal-dockview .dv-tabs-container:not([data-tab-density='regular']) .dv-tab:is(:hover, :focus-within) .workspace-tab__close", ['opacity', 'transform', 'pointer-events']],
    [".bandal-dockview .dv-tabs-container[data-tab-density='icon'] .workspace-tab__close", ['left']],
    ['.bandal-dockview .dv-tab:focus-within .workspace-tab__close', ['opacity', 'transform']]
  ])
  return text.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector, body) => {
    const properties = allowed.get(selector.trim())
    if (!properties) return rule
    const declarations = body.split(';').map(value => value.trim()).filter(Boolean)
    if (!declarations.every(value => properties.includes(value.split(':', 1)[0].trim()))) return rule
    return ''
  }).trim()
}

export function onlyMaterialChromeChanged(file, before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return false
  before = before.replaceAll('\r\n', '\n'); after = after.replaceAll('\r\n', '\n')
  if (before === after) return false
  if (['src/main/ipc/registerHandlers.ts', 'src/shared/ipc/contract.ts', 'src/main/features/agentTools/coverage.ts', 'src/renderer/src/features/pdf/PdfToolbar.tsx'].includes(file)) {
    const previous = materialHostRemainder(file, before), next = materialHostRemainder(file, after)
    return previous !== null && next !== null && previous === next
  }
  if (Object.hasOwn(MATERIAL_CHROME_EDITS, file)) return exactSourceEdits(before, after, MATERIAL_CHROME_EDITS[file])
  if (file === 'src/renderer/src/features/browser/browserTabEvents.ts') {
    const scope = { names: ['createTabFaviconController'], imports: [], required: ['createTabFaviconController'] }
    const previous = tabPickerRemainder(file, before, scope), next = tabPickerRemainder(file, after, scope)
    return previous !== null && next !== null && previous === next
  }
  if (file === 'src/renderer/src/features/workspace/adaptive-tabs.css') return tabCloseStyleRemainder(before) === tabCloseStyleRemainder(after)
  if (file === 'src/renderer/src/features/assistantPanel/AssistantPanelToggle.tsx') {
    const print = text => ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true))
    return print(before) === print(after)
  }
  return false
}

/** Keep type/unit inputs intact and fail closed on an unknown host edit. */
export function materialChromeE2eFiles(files, readBefore, readAfter) {
  const isolated = new Map()
  for (const file of files) {
    if (Object.hasOwn(MATERIAL_CHROME_FILES, file)) {
      isolated.set(file, MATERIAL_CHROME_FILES[file])
      continue
    }
    if (!MATERIAL_CHROME_HOSTS.has(file)) continue
    try {
      if (!onlyMaterialChromeChanged(file, readBefore(file), readAfter(file))) continue
    } catch { continue }
    isolated.set(file, file === 'src/main/features/agentTools/coverage.ts' ? ['materialShare']
      : file === 'src/main/ipc/registerHandlers.ts' ? ['materialToolbar', 'materialShare', 'pdfExport', 'browserFavicons']
      : file.includes('/browser/') ? ['browserFavicons'] : file.endsWith('/adaptive-tabs.css')
      ? ['workspaceNarrowTabs'] : file.includes('/assistantPanel/') ? ['materialToolbar', 'assistantSidebar', 'browserChrome']
        : ['materialToolbar', 'pdfExport'])
  }
  if (isolated.size === 0) return files
  return [...new Set(files.filter(file => !isolated.has(file)).concat(
    [...isolated.values()].flat().map(name => `e2e/${name}.spec.ts`)
  ))]
}

export function materialChromeE2eGrep(plan, files, readBefore, readAfter) {
  const spec = 'e2e/courseTabMove.spec.ts'
  if (plan.full || !files.includes(spec) || !plan.e2e.includes(spec) ||
    plan.e2e.some(file => /\/(?:tabDrag|tabMoveSessions|courseMovePreview|materialsDrag)\.spec\.ts$/.test(file))) return plan.e2eGrep
  try {
    if (!exactSourceEdits(readBefore(spec).replaceAll('\r\n', '\n'), readAfter(spec).replaceAll('\r\n', '\n'), [
      ["element.querySelector('.note-toolbar__path')?.getAttribute('title')", "element.querySelector('.note-tab')?.getAttribute('data-resource-path')"]
    ])) return plan.e2eGrep
  } catch { return plan.e2eGrep }
  // A diagnostic selector follows the removed note title. The live note and
  // PDF-note moves exercise save/resource binding without repeating browser drag.
  const grep = plan.e2eGrep ?? plan.e2e.map(file => file.replace('e2e/', '').replaceAll('.', '\\.')).join('|')
  return grep.replace('courseTabMove\\.spec\\.ts', 'note movement keeps its editor|PDF note movement preserves editable committed text')
}

/** The exact installed PDF library only moves into the packaged runtime. */
export function onlyLockedPdfDependencyPromoted(before, after, beforeLock, afterLock) {
  const name = 'pdf-lib', specifier = '^1.17.1', version = '1.17.1'
  if (before.devDependencies?.[name] !== specifier || after.dependencies?.[name] !== specifier ||
    Object.hasOwn(before.dependencies ?? {}, name) || Object.hasOwn(after.devDependencies ?? {}, name) ||
    ['optionalDependencies', 'peerDependencies'].some(group => Object.hasOwn(before[group] ?? {}, name) || Object.hasOwn(after[group] ?? {}, name))) return false
  const previous = structuredClone(before), next = structuredClone(after)
  delete previous.version
  delete next.version
  delete previous.devDependencies[name]
  delete next.dependencies[name]
  if (JSON.stringify(previous) !== JSON.stringify(next)) return false

  beforeLock = beforeLock.replaceAll('\r\n', '\n')
  afterLock = afterLock.replaceAll('\r\n', '\n')
  const section = (text, name, indent = 0) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const expression = new RegExp(`^${' '.repeat(indent)}${escaped}:\\n([\\s\\S]*?)(?=^ {0,${indent}}\\S|(?![\\s\\S]))`, 'gm')
    const matches = [...text.matchAll(expression)]
    return matches.length === 1 ? matches[0] : null
  }
  const rootGroup = (lock, group) => {
    const importers = section(lock, 'importers')
    const root = importers && section(importers[0], '.', 2)
    const found = root && section(root[0], group, 4)
    return found ? { text: found[0], start: importers.index + root.index + found.index } : null
  }
  const entry = `      ${name}:\n        specifier: ${specifier}\n        version: ${version}\n`
  const withoutEntry = (lock, from, absent) => {
    const source = rootGroup(lock, from), other = rootGroup(lock, absent)
    if (!source || !other || other.text.includes(`\n      ${name}:\n`) || source.text.split(entry).length !== 2) return null
    return lock.slice(0, source.start) + source.text.replace(entry, '') + lock.slice(source.start + source.text.length)
  }
  // Require an existing graph, then compare every byte outside the moved
  // importer entry: settings, other importers, packages and snapshots alike.
  for (const name of ['packages', 'snapshots']) {
    if (!section(beforeLock, name)?.[0].includes(`\n  pdf-lib@${version}:\n`)) return false
  }
  const previousLock = withoutEntry(beforeLock, 'devDependencies', 'dependencies')
  const nextLock = withoutEntry(afterLock, 'dependencies', 'devDependencies')
  return previousLock !== null && nextLock !== null && previousLock === nextLock
}

export function pdfDependencyPromotionInputs() {
  // Discover all tracked runtime source consumers, including new ones. Tests
  // that only use pdf-lib to manufacture fixtures are not runtime consumers.
  const consumers = git('ls-files', '-z', '--', 'src', 'resources').split('\0').filter(file =>
    /\.[cm]?[jt]sx?$/.test(file) && existsSync(file) &&
    /['"]pdf-lib(?:\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8'))
  )
  if (consumers.length === 0) throw new Error('Cannot scope the PDF dependency promotion without runtime consumers.')
  return [...new Set([...consumers,
    'resources/ipad-bridge/bridge.py',
    'resources/ipad-bridge/projector-host.cjs',
    'src/main/features/ipadSync/runtime.ts',
    'src/main/features/pdf/pdfNotes.ts',
    'tests/main/ipadSync/projectorDurability.test.ts'
  ])]
}

export function onlyLiveBillingConfigAdded(before, after) {
  const added = '\n\n[functions.paddle-billing-live]\nverify_jwt = false\n\n[functions.paddle-webhook-live]\nverify_jwt = false\n'
  return !before.includes('[functions.paddle-billing-live]') &&
    before.replaceAll('\r\n', '\n').trimEnd() + added === after.replaceAll('\r\n', '\n')
}

/** Only direct imports of these existing renderer libraries can narrow scope. */
export function onlyLockedChatDependenciesPromoted(before, after, beforeLock, afterLock) {
  const versions = { katex: '0.18.1', remark: '15.0.1', 'remark-gfm': '4.0.1', 'remark-math': '6.0.0' }
  const previous = structuredClone(before), next = structuredClone(after)
  delete previous.version
  delete next.version
  const added = Object.entries(versions).filter(([name, version]) =>
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].every(group => !Object.hasOwn(before[group] ?? {}, name)) && after.devDependencies?.[name] === version
  )
  if (!added.length) return false
  for (const [name] of added) delete next.devDependencies[name]
  if (JSON.stringify(previous) !== JSON.stringify(next)) return false

  // Only normalize checkout line endings. Every other byte, including the
  // entire packages/snapshots graph and all other importers, must be unchanged.
  beforeLock = beforeLock.replaceAll('\r\n', '\n')
  afterLock = afterLock.replaceAll('\r\n', '\n')
  const section = (text, name, indent = 0) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`^${' '.repeat(indent)}${escaped}:\\n([\\s\\S]*?)(?=^ {0,${indent}}\\S|(?![\\s\\S]))`, 'm').exec(text)
  }
  const rootDevDependencies = lock => {
    const importers = section(lock, 'importers')
    const root = importers && section(importers[0], '.', 2)
    const dev = root && section(root[0], 'devDependencies', 4)
    return dev ? { text: dev[0], start: importers.index + root.index + dev.index } : null
  }
  const oldDev = rootDevDependencies(beforeLock), newDev = rootDevDependencies(afterLock)
  const packages = section(beforeLock, 'packages'), snapshots = section(beforeLock, 'snapshots')
  if (!oldDev || !newDev || !packages || !snapshots) return false
  let stripped = newDev.text
  for (const [name, version] of added) {
    const lockedEntry = `\n  ${name}@${version}:\n`
    if (!packages[0].includes(lockedEntry) || !snapshots[0].includes(lockedEntry)) return false
    const entry = `      ${name}:\n        specifier: ${version}\n        version: ${version}\n`
    if (oldDev.text.includes(`\n      ${name}:\n`) || stripped.split(entry).length !== 2) return false
    stripped = stripped.replace(entry, '')
  }
  return beforeLock === afterLock.slice(0, newDev.start) + stripped + afterLock.slice(newDev.start + newDev.text.length)
}

export function onlyVersionOrBrowserImportHookChanged(before, after) {
  const normalize = value => {
    const copy = structuredClone(value)
    delete copy.version
    if (copy.scripts?.dev === 'node scripts/build-calendar.mjs && node scripts/build-browser-import.mjs && electron-vite dev') {
      copy.scripts.dev = 'node scripts/build-calendar.mjs && electron-vite dev'
    }
    return copy
  }
  return JSON.stringify(normalize(before)) === JSON.stringify(normalize(after))
}

export function onlyBrowserGestureEntryChanged(before, after) {
  // Git blobs use LF while Windows checkouts may use CRLF.
  const strip = value => value.replaceAll('\r\n', '\n').replace(/^\s*browserGesture: resolve\(__dirname, 'src\/preload\/browserGesture\.ts'\),?\n/gm, '').trim()
  return strip(before) === strip(after)
}

export function onlyHoverPreviewEntryChanged(before, after) {
  const strip = value => value.replaceAll('\r\n', '\n').replace(/^\s*hoverPreviewHost: resolve\(__dirname, 'src\/main\/features\/materials\/hoverPreviewHost\.ts'\),?\n/gm, '').trim()
  return strip(before) === strip(after)
}

export function onlyPdfSearchEntryAdded(before, after) {
  const previous = before.replaceAll('\r\n', '\n')
  const next = after.replaceAll('\r\n', '\n')
  const anchor = "          backgroundHost: resolve(__dirname, 'src/main/background/host.ts'),\n"
  const entry = "          pdfSearchHost: resolve(__dirname, 'src/main/features/search/pdfSearchHost.ts'),\n"
  // Only this one addition is proven isolated: preserve every existing option,
  // entry and plugin, and reject removals, duplicates or alternate entry paths.
  return !previous.includes('pdfSearchHost') && previous.split(anchor).length === 2 &&
    next === previous.replace(anchor, anchor + entry)
}

export function onlySwipeRegistrationChanged(before, after) {
  // A visibility predicate passed to the gesture bridge does not change native
  // tab placement or dragging. Keep their unit coverage, but run gesture E2E.
  const registration = '  installSwipeNavigation(wc, () => !tab.host.isDestroyed() && tab.host.isVisible() && !tab.host.isMinimized() && tab.view.getVisible())'
  const strip = value => value.replaceAll('\r\n', '\n').split('\n')
    .map(line => line === registration ? '  installSwipeNavigation(wc)' : line).join('\n').trim()
  return before !== after && strip(before) === strip(after)
}

export function planChecks(files, full = false) {
  const has = (pattern) => files.some((file) => pattern.test(file))
  // Global runtime/toolchain changes justify a broad check; routine features do not.
  full ||= has(/^(package\.json|pnpm-lock\.yaml|electron\.vite\.config\.ts|vitest\.config\.ts|tests\/setup\.ts)$/)
  const sharedBackendConfig = has(/^supabase\/(?:config\.toml|functions\/deno\.(?:json|lock))$/)
  const communityBackend = full || has(/^(?:supabase\/migrations\/.*community|tests\/backend\/community\/)/)
  const studyMarketBackend = full || sharedBackendConfig || has(/^(supabase\/(?:functions\/(?:_shared\/study-market\/|study-market(?:-webhook|-cron)?\/)|migrations\/.*study_market)|tests\/backend\/studyMarket\/|src\/shared\/types\/studyMarket\.ts$)/)
  const paddleBillingBackend = full || sharedBackendConfig || has(/^(supabase\/(?:functions\/(?:_shared\/paddle-billing\/|paddle-(?:billing|webhook)(?:-live)?\/)|migrations\/.*paddle_billing)|tests\/backend\/paddleBilling\/)/)
  const appleBillingBackend = full || sharedBackendConfig || has(/^(supabase\/(?:functions\/(?:_shared\/apple-billing\/|apple-(?:billing|notifications)(?:-sandbox)?\/)|migrations\/.*apple_billing)|tests\/backend\/appleBilling\/(?!deletion))/)
  const accountDeletionBackend = full || sharedBackendConfig || has(/^(supabase\/(?:functions\/(?:_shared\/account-delete\/|account-delete\/)|migrations\/.*account_deletion)|tests\/backend\/appleBilling\/deletion)/)
  const syncAccessBackend = full || sharedBackendConfig || appleBillingBackend || accountDeletionBackend || has(/^(supabase\/migrations\/.*(?:personal_sync|sync_paid_access|sync_quota_errors|paddle_billing)|tests\/backend\/syncAccess\/)/)
  const types = new Set()
  if (full || has(/^(src\/(main|preload|shared)\/|server\/|sdk\/|(?:marketplace|sdk)\.vite\.config\.ts|tsconfig\.node\.json)/)) types.add('tsconfig.node.json')
  if (full || has(/^(src\/(renderer|shared)\/|src\/preload\/browser|tsconfig\.web\.json)/)) types.add('tsconfig.web.json')
  if (full || has(/^(web-demo\/|src\/shared\/|web-demo\/tsconfig\.json)/)) types.add('web-demo/tsconfig.json')
  const scriptTests = new Set(files.filter((f) => /^scripts\/test-.*\.mjs$/.test(f)))
  const ipadBilling = full || has(/^(resources\/ipad-bridge\/bridge\.py|src\/main\/features\/ipadSync\/runtime\.ts|tests\/main\/ipadSync\/test_bridge_billing\.py|e2e\/ipadBilling\.spec\.ts)$/)
  const pythonTests = ipadBilling ? ['tests/main/ipadSync/test_bridge_billing.py'] : []
  if (has(/^(resources\/ipad-bridge\/|tests\/main\/ipadSync\/test_bridge_scope\.py$)/)) pythonTests.push('tests/main/ipadSync/test_bridge_scope.py')
  if (full || has(/^(resources\/ipad-bridge\/bridge\.py|src\/main\/features\/ipadSync\/runtime\.ts|tests\/main\/ipadSync\/test_bridge_cancellation\.py)$/)) pythonTests.push('tests/main/ipadSync/test_bridge_cancellation.py')
  if (full || has(/^(resources\/ipad-bridge\/bridge\.py|src\/main\/features\/ipadSync\/runtime\.ts|tests\/main\/ipadSync\/test_bridge_stdio\.py|\.github\/workflows\/verify-windows-projector\.yml)$/)) pythonTests.push('tests/main/ipadSync/test_bridge_stdio.py')
  if (has(/^(sdk\/|sdk\.vite\.config\.ts$|scripts\/test-plugin-sdk\.mjs$)/)) scriptTests.add('scripts/test-plugin-sdk.mjs')
  if (has(/^(scripts\/(affected-checks|reuse-ci)\.mjs|\.github\/workflows\/)/)) scriptTests.add('scripts/test-affected-checks.mjs')
  if (has(/^scripts\/(upload-release-assets|lib\/release-assets|test-release-assets)\.mjs$/)) scriptTests.add('scripts/test-release-assets.mjs')
  if (has(/^scripts\/browser-auth-probe\.mjs$/)) scriptTests.add('scripts/test-browser-auth-probe.mjs')
  if (has(/^(?:\.github\/workflows\/verify-windows-cloud-sync\.yml|scripts\/verify-windows-cloud-sync\.cjs)$/)) scriptTests.add('scripts/test-windows-cloud-sync.mjs')
  for (const action of ['readiness', 'register']) {
    if (files.some(file => file === `.github/workflows/apple-ipad-${action}.yml` || file === `scripts/apple-ipad-${action}.mjs`)) scriptTests.add(`scripts/test-apple-ipad-${action}.mjs`)
  }
  const e2e = new Set(files.filter((f) => existsSync(f) && /^e2e\/[^/]+\.spec\.ts$/.test(f)))
  if (has(/^src\/(?:renderer\/src\/features\/annotation\/|main\/(?:features\/browser\/annotation|ipc\/annotationHandlers)|shared\/(?:types\/chatAnnotation|ipc\/annotationContract))/)) e2e.add('e2e/annotation.spec.ts')
  if (has(/^src\/(?:renderer\/src\/features\/(?:assistantPanel\/|chat\/studyMode)|main\/features\/(?:learning\/(?:learningRuntime|learningAgent)\.ts$|agent\/chatStudyRecords)|shared\/types\/study\.ts$)/)) e2e.add('e2e/workspaceStudyModes.spec.ts')
  if (has(/^src\/(?:renderer\/src\/features\/learning\/(?:LearningSpacesPanel|ProjectGroupMenu|projectNavigation)|main\/db\/projectNavigation|shared\/projectNavigation)/)) e2e.add('e2e/projectGroups.spec.ts')
  if (has(/^src\/renderer\/src\/features\/materials\/(?:MaterialViews|MaterialTree|MaterialsSidebar|materialViewPreference|materials)\./)) e2e.add('e2e/materialViews.spec.ts')
  if (has(/^src\/main\/features\/search\//)) {
    e2e.add('e2e/materialViews.spec.ts')
    e2e.add('e2e/coursePerformance.spec.ts')
  }
  if (has(/^src\/renderer\/src\/(?:app\/(?:AppShell|RightSidebar|shortcuts)\.tsx?$|stores\/(?:uiStore|workspaceStore)\.ts$|features\/(?:materials\/(?:MaterialsSidebar|MaterialViews|MaterialTree|materialsExpanded)\.(?:tsx|css)$|pdfNotes\/NewNoteSheet\.tsx$|workspace\/openMaterial\.ts$|browser\/(?:nativeHostVisibility|webviewPassthrough|useNativePageOcclusion)\.ts$))/)) e2e.add('e2e/materialExpanded.spec.ts')
  if (has(/^(?:src\/(?:main\/(?:features\/externalSources\/|ipc\/externalSourcesHandlers\.ts$)|renderer\/src\/features\/materials\/(?:ExternalSourcesPanel|externalSources)\.|shared\/types\/externalSources\.ts$)|native\/photo-picker\/|scripts\/build-photo-picker\.mjs$)/)) e2e.add('e2e/externalSources.spec.ts')
  if (has(/^(?:src\/(?:main\/(?:features\/share\/|ipc\/shareHandlers\.ts$)|renderer\/src\/features\/share\/|shared\/types\/share\.ts$)|native\/share-extension\/|scripts\/(?:build-share-extension|sign-mac|verify-share-extension)\.mjs$)/)) e2e.add('e2e/shareImport.spec.ts')
  if (ipadBilling) e2e.add('e2e/ipadBilling.spec.ts')
  if (has(/^(?:resources\/ipad-bridge\/bridge\.py|src\/main\/features\/ipadSync\/runtime\.ts)$/)) {
    e2e.add('e2e/accountNotes.spec.ts')
    e2e.add('e2e/accountProfileBackup.spec.ts')
  }
  if (has(/^src\/(?:renderer\/src\/features\/pdf\/(?:clipTransfer|renderClip|useWhiteboardClipDelivery|ClipOriginalDialog|PdfPageView)\.tsx?$|main\/features\/pdf\/pdfClipSource\.ts$)/)) e2e.add('e2e/pdfClip.spec.ts')
  if (has(/^src\/(?:main\/features\/(?:account\/|pdf\/(?:pdfNotes|legacyNoteMigration|noteFileTransaction)\.ts)|renderer\/src\/features\/(?:pdfNotes\/|materials\/NotesGroup\.tsx|settings\/(?:AccountPanel|BillingSyncPanel|TabsSettingsPanel)\.tsx)|shared\/(?:types\/(?:auth|subscription|pdfNote)\.ts|tabPreferences\.ts))/)) {
    e2e.add('e2e/accountNotes.spec.ts')
    e2e.add('e2e/accountProfileBackup.spec.ts')
  }
  if (has(/^src\/(?:main\/ipc\/(?:workspaceTransition|registerHandlers)\.ts|renderer\/src\/(?:features\/documents\/workspaceTransition|main)\.tsx?|preload\/index\.ts|shared\/ipc\/(?:events|contract)\.ts)$/)) e2e.add('e2e/accountProfileBackup.spec.ts')
  if (studyMarketBackend || has(/^src\/(?:main\/(?:features\/studyMarket\/|ipc\/studyMarketHandlers\.ts$)|shared\/(?:types\/studyMarket\.ts$|ipc\/studyMarketContract\.ts$)|renderer\/src\/(?:features\/studyMarket\/|app\/studyMarketNavigation\.ts$))/)) e2e.add('e2e/studyMarket.spec.ts')
  if (communityBackend || has(/^src\/(?:main\/(?:features\/community\/|ipc\/communityHandlers\.ts$)|shared\/(?:types\/community\.ts$|ipc\/communityContract\.ts$)|renderer\/src\/(?:features\/community\/|app\/communityNavigation\.ts$))/)) e2e.add('e2e/community.spec.ts')
  if (has(/^src\/(?:renderer\/src\/features\/materials\/(?:MaterialAffordances|materialAffordances|materialStatus|preview\/)|main\/features\/materials\/(?:hoverPreview|materialAdded)|shared\/types\/materialHoverPreview)/)) {
    e2e.add('e2e/materialPreview.spec.ts')
    e2e.add('e2e/materialsDrag.spec.ts')
  }
  const browserSettings = /^src\/renderer\/src\/features\/settings\/(browser\/|(?:SavedLoginsSettings|BrowsingDataPanel)\.tsx$)/
  const launcherShell = /^src\/renderer\/src\/app\/(AppShell|GlobalNavigation|RailResizer)\.tsx$/
  const packSettings = /^src\/renderer\/src\/features\/settings\/PacksPanel\.tsx$/
  const settingsShell = /^src\/renderer\/src\/features\/settings\/(?:SettingsApp|SettingsPanels)\.tsx$/
  const pluginSettings = /^src\/renderer\/src\/features\/settings\/(?:catalog\/|pluginCenter\/|(?:PluginsCategoryPanel|PluginConfiguration|PluginDevelopmentPanel|ExtensionsPanel|PacksPanel|McpServersPanel|McpQuickAdd|MarketplacePanel|PluginFeatureMark|pluginCenterModel|mcpPresets|mcpImport|packImport)\.tsx?$|settings-(?:plugins|packs|mcp)\.css$|plugin-center)/
  const sharedAppearance = files.some(file => !browserSettings.test(file) && !launcherShell.test(file) && !packSettings.test(file) && !settingsShell.test(file) && !pluginSettings.test(file) && file !== 'src/renderer/src/features/settings/settingsSearchIndex.ts' && file !== 'src/renderer/src/components/BandalMark.tsx' && file !== 'src/renderer/src/app/tabCommands.ts' && file !== 'src/renderer/src/app/studyMarketNavigation.ts' && file !== 'src/renderer/src/app/communityNavigation.ts' && /^(src\/shared\/(theme|appearance)\.ts|src\/renderer\/src\/(styles\/|app\/|components\/|features\/settings\/))/.test(file))
  if (has(launcherShell) || has(/^src\/renderer\/src\/(features\/launcher\/|stores\/(workflowPacksStore|uiStore)\.ts$)/) || has(packSettings)) e2e.add('e2e/featureLauncher.spec.ts')
  if (has(launcherShell)) {
    e2e.add('e2e/sidebars.spec.ts')
    e2e.add('e2e/settingsShell.spec.ts')
  }
  if (has(settingsShell) || has(/^src\/(?:shared\/settingsCategories\.ts$|renderer\/src\/features\/settings\/settingsSearchIndex\.ts$)/)) e2e.add('e2e/settingsShell.spec.ts')
  if (has(pluginSettings) || has(/^src\/(?:shared\/settingsCategories\.ts$|main\/features\/mcpRegistry\/)/)) e2e.add('e2e/pluginCenter.spec.ts')
  if (has(/^src\/renderer\/src\/features\/onboarding\//) || has(/^src\/renderer\/src\/features\/settings\/SettingsPanels\.tsx$/)) e2e.add('e2e/onboarding.spec.ts')
  if (has(/^src\/renderer\/src\/features\/plugins\/(pluginCommands|PluginMenuItems)\.tsx?$/)) e2e.add('e2e/pluginsV2.spec.ts')
  if (has(/^src\/(main\/(features\/plugins\/|pluginHost\/)|preload\/pluginHost\.ts$|shared\/types\/pluginRpc\.ts$)/)) {
    e2e.add('e2e/pluginSandbox.spec.ts')
    e2e.add('e2e/pluginsV2.spec.ts')
  }
  if (has(/^src\/main\/ipc\/(appRendererSender|rendererSender)\.ts$/)) e2e.add('e2e/ipcSender.spec.ts')
  if (sharedAppearance) {
    for (const spec of ['theme', 'sidebars', 'settingsShell', 'uiRedesign', 'tabDrag', 'favoritesDrag', 'materialsDrag', 'viewportMenus']) e2e.add(`e2e/${spec}.spec.ts`)
    scriptTests.add('scripts/check-contrast.mjs')
  }
  if (has(/^src\/renderer\/src\/features\/pdf\/(PdfToolbar|tools\/)/)) {
    for (const spec of ['pdfTextbox', 'eraser']) e2e.add(`e2e/${spec}.spec.ts`)
  }

  if (has(/^(src\/main\/features\/(pdf\/|canvas\/|presentation\/|pdfText|textboxPdfLayout)|src\/shared\/(types\/drawing|textBoxMetrics)|resources\/fonts\/|e2e\/helpers\/renderPdf)/)) e2e.add('e2e/pdfExport.spec.ts')
  if (has(/^src\/renderer\/src\/features\/(pdf|ink)\//)) e2e.add('e2e/pdfTextbox.spec.ts')
  if (has(/^src\/renderer\/src\/features\/(?:links\/(?:pdfPageNoteSync|pageSyncScroll)\.ts$|pdf\/PdfTab\.tsx$)/)) e2e.add('e2e/interactionStability.spec.ts')
  if (has(/(renderInkSnapshot|pageImage)/i)) e2e.add('e2e/pageImageCopy.spec.ts')
  if (has(/(systemClipboard|noteImagePlugin|BufferedPdfCanvas|zoomInput)/)) e2e.add('e2e/interactionFixes.spec.ts')
  if (has(/(BrowserAddress|browserSearch|urlInput|useAddressSuggestions)/)) e2e.add('e2e/browserAddress.spec.ts')
  if (has(/^src\/renderer\/src\/features\/(?:browser\/(?:BrowserPanel|BrowserToolbarOverflow|BrowserProfilePicker|browser|browserProfiles)\.(?:tsx|css)|assistantPanel\/(?:TabAssistantPanel|AssistantPanelToggle|panelContext)\.tsx?)$/)) e2e.add('e2e/browserChrome.spec.ts')
  if (has(/^src\/(?:renderer\/src\/features\/browser\/(?:BrowserPanel|BrowserLoginPrompt|browserLoginPrompt|loginBridge)\.(?:tsx?|css)|main\/features\/credentials\/loginCapture\.ts|shared\/types\/credentials\.ts)$/)) e2e.add('e2e/browserPasswordPrompt.spec.ts')
  const browserSwipe = /^src\/(?:main\/features\/browser\/swipeNavigation|preload\/browser(?:Gesture|Swipe(?:Parents)?))\.ts$/
  if (has(browserSwipe)) e2e.add('e2e/browserSwipe.spec.ts')
  if (files.some(file => !browserSwipe.test(file) && /^src\/.*\/browser\/|src\/preload\/browser|src\/main\/windows\/assistantWindow|src\/renderer\/src\/features\/assistant\//.test(file))) e2e.add('e2e/browserCompatibility.spec.ts')
  const browserImport = has(/^(src\/main\/features\/(browser\/(import\/|(?:profiles|historyRepo)\.ts$)|credentials\/)|src\/main\/ipc\/browserImportHandlers\.ts$|src\/renderer\/src\/features\/browser\/(BrowserImportDialog\.tsx|BrowserPanel\.tsx|browserImport\.css|loginBridge\.ts|browserFavorite\.ts|browserStartPageModel\.ts)$|src\/shared\/types\/(browserImport|browserProfile|credentials)\.ts$|(?:native|resources\/native)\/browser-import\/|scripts\/(build-browser-import|verify-browser-import|build-native)\.mjs$)/) || has(browserSettings)
  if (browserImport) {
    e2e.add('e2e/browserImport.spec.ts')
    e2e.add('e2e/browserCompatibility.spec.ts')
  }
  const learning = has(/^src\/(main\/(features\/(learning|workflowPacks)\/|ipc\/learningHandlers\.ts$)|renderer\/src\/features\/learning\/|shared\/(learning\/|workflowPacks\/|types\/(learning|workflowPack)\.ts$|ipc\/learningContract\.ts$))/)
  const dictionaryResources = has(/^(resources\/dictionary\/|scripts\/build-dictionary\.mjs$)/)
  if (has(/^src\/renderer\/src\/features\/learning\/(?:EnglishReadingGuide\.tsx|englishReadingGuide(?:State\.ts|\.css)|LearningCreateDialog\.tsx|LearningTab\.tsx)$/)) e2e.add('e2e/englishReadingGuide.spec.ts')
  if (dictionaryResources || has(/^src\/(?:main\/features\/learning\/dictionary\.ts$|shared\/types\/dictionary\.ts$|renderer\/src\/features\/(?:study\/|learning\/(?:LearningReader|ReaderDictionaryPopover|readerSelection)\.|materials\/MaterialsStudyToolMenuItem\.))/)) e2e.add('e2e/readingTools.spec.ts')
  if (learning) {
    e2e.add('e2e/learning.spec.ts')
    e2e.add('e2e/learningSpaces.spec.ts')
  }
  const learningUx = has(/^src\/renderer\/src\/(features\/(learning\/|launcher\/|workspace\/(WorkspaceHost\.tsx|openMaterial\.ts)|assistantPanel\/assistantController\.ts|agent\/workspaceSync\.ts)|stores\/workspaceStore\.ts|app\/(GlobalNavigation\.tsx|tabCommands\.ts))|^src\/main\/(features\/learning\/(learningRepo|learningRuntime|learningCache)\.ts|ipc\/learningHandlers\.ts)$/)
  if (learningUx) { e2e.add('e2e/learningManagement.spec.ts'); e2e.add('e2e/learningNavigation.spec.ts') }
  if (has(/^src\/(main\/(features\/courses\/coursesRepo\.ts$|features\/agent\/(SessionManager|agentModels|codex\/modelCatalog)\.ts$|db\/migrations\.ts$)|shared\/types\/course\.ts$|renderer\/src\/features\/courses\/CourseSidebar\.tsx$)/)) e2e.add('e2e/learningSpaces.spec.ts')
  if (has(/^src\/renderer\/src\/features\/widgets\/WidgetDock\.tsx$/)) e2e.add('e2e/taskSchedule.spec.ts')
  if (has(/^src\/main\/(features\/materials\/(renameWithRetry|watcher)\.ts|background\/(materialsWatcher|watcherHost)\.ts)$/)) {
    e2e.add('e2e/learning.spec.ts')
    e2e.add('e2e/materialsDrag.spec.ts')
  }
  if (has(/^src\/(?:renderer\/src\/(?:app\/(?:WorkspaceControls|HomeSidebar|AppShell|RightSidebar|app-shell)\.|features\/workspace\/|stores\/workspaceStore\.ts$)|shared\/(?:workspaceWindows|workspacePanelIds|ipc\/workspacePreviewContract)\.ts$|main\/(?:features\/workspace\/|ipc\/workspacePreviewHandlers\.ts$))/)) e2e.add('e2e/workspaceWindows.spec.ts')
  const workspace = has(/^(src\/renderer\/src\/(features\/workspace\/|stores\/workspaceStore\.ts$)|src\/shared\/tabs\.ts$)/)
  if (workspace) {
    for (const spec of ['tabs', 'tabDrag', 'workspaceLayout', 'workspaceNarrowTabs', 'workspaceCourseDrop', 'favoritesDrag', 'materialsDrag', 'viewportMenus', 'coursePerformance']) e2e.add(`e2e/${spec}.spec.ts`)
  }
  const boardCoursePicker = /^src\/renderer\/src\/features\/board\/BoardPanel\.tsx$/
  if (has(boardCoursePicker)) e2e.add('e2e/taskSchedule.spec.ts')
  if (files.some(file => !boardCoursePicker.test(file) && /^src\/.*(calendar\/|appleCalendar\/|board\/|taskSchedule|calendarDate|types\/board)/.test(file))) {
    e2e.add('e2e/taskSchedule.spec.ts')
    e2e.add('e2e/appleCalendar.spec.ts')
  }
  if (has(/(useViewportBounds|BoardEditor|CalendarForm)/)) e2e.add('e2e/viewportMenus.spec.ts')
  if (has(/^src\/(main\/(background\/|db\/|index\.ts|features\/materials\/)|preload\/index\.ts|renderer\/src\/(features\/workspace\/|stores\/workspaceStore))/)) e2e.add('e2e/coursePerformance.spec.ts')
  if (has(/^src\/renderer\/src\/features\/notes\/(NoteTab|NoteToolbar|noteEditorPlugins|noteFormatting|nativeHistoryGuard)/)) e2e.add('e2e/noteToolbar.spec.ts')
  if (full) {
    for (const spec of ['pdfExport', 'browserAddress', 'browserCompatibility', 'browserSwipe', 'browserImport', 'learning', 'tabDrag', 'favoritesDrag', 'materialsDrag', 'pageImageCopy', 'taskSchedule', 'appleCalendar', 'viewportMenus', 'coursePerformance']) {
      e2e.add(`e2e/${spec}.spec.ts`)
    }
  }
  // At least one launch for an installer with no feature-specific E2E coverage.
  if (has(/src\/(main\/(features\/(agent|agentTools|browserAgent|desktopAgent)|windows\/(assistantWindow|approvalWindow|screenSelection|overlay))|renderer\/src\/features\/(chat|assistantPanel|overlay)|shared\/(types\/(chat|aiAccess)|moonGeometry|brandMark|screenGeometry))/)) { e2e.add('e2e/chatUx.spec.ts'); e2e.add('e2e/assistantSidebar.spec.ts'); e2e.add('e2e/aiContext.spec.ts') }
  if (has(/^src\/(main\/features\/agent\/|renderer\/src\/features\/(?:ai\/|chat\/(?:agentConnectionStore|agentConnectionCopy|agent-connection|AgentConnectionControls|AgentSetupCards|chatSessionStore|ChatSurface)\.|settings\/(?:SettingsApp|SettingsPanels)\.)|shared\/(?:agentProviderSelection|types\/agent-events)\.ts$)/)) e2e.add('e2e/aiConnections.spec.ts')
  if (has(/^src\/main\/features\/agent\/login(?:BrowserBridge|Launcher)\.ts$/)) e2e.add('e2e/loginBrowserBridge.spec.ts')
  if (has(/^src\/renderer\/src\/features\/browser\/agentLoginTabs\.ts$/)) e2e.add('e2e/aiConnections.spec.ts')
  if (workspace || has(/^src\/(?:renderer\/src\/features\/(?:courses\/(?:CourseSidebar|CourseListItem|useWorkspaceCourseHover)\.|browser\/(?:BrowserGuestView|nativePageHandle|browserGuestsStore)\.)|main\/(?:db\/layoutRepo\.ts$|features\/browser\/nativeTabs\.ts$))/)) {
    e2e.add('e2e/courseTabMove.spec.ts')
    e2e.add('e2e/tabMoveSessions.spec.ts')
    e2e.add('e2e/courseMovePreview.spec.ts')
  }
  if (has(/^src\/renderer\/src\/features\/materials\/(?:MaterialTree|MaterialsSidebar)\.tsx$/) || has(/^src\/main\/lib\/atomicWrite\.ts$/)) e2e.add('e2e/courseTabMove.spec.ts')
  if (has(/^src\/renderer\/src\/features\/courses\/FavoritesSection\.tsx$/)) {
    e2e.add('e2e/favoritesDrag.spec.ts')
    e2e.add('e2e/courseMovePreview.spec.ts')
  }
  if (has(/^src\/(?:renderer\/src\/(?:features\/(?:updates\/|account\/(?:SidebarAccountEntry\.tsx|AccountAvatar\.tsx|account\.css)$|help\/(?:HelpHub\.tsx|help\.css)$)|stores\/updateStore\.ts$|app\/GlobalNavigation\.tsx$)|main\/features\/updater\/|shared\/types\/update\.ts$)/)) e2e.add('e2e/railUx.spec.ts')
  if (has(/^src\/(?:renderer\/src\/features\/(?:workspace\/(?:panelContentHost|WorkspaceHost|panels\/browserAnchor)\.|browser\/(?:BrowserGuestView|nativePageHandle)\.)|main\/features\/browser\/nativeTabs\.ts$)/)) e2e.add('e2e/browserPlacement.spec.ts')
  // Server-only billing changes have no packaged desktop flow to exercise.
  const paddleBackendOnly = (paddleBillingBackend || appleBillingBackend || accountDeletionBackend || syncAccessBackend) && !studyMarketBackend && !has(/^(src\/|server\/|sdk\/|resources\/|native\/|electron|package\.json$|pnpm-lock\.yaml$)/)
  if (e2e.size === 0 && !paddleBackendOnly) e2e.add('e2e/startup.spec.ts')
  const unitInputs = files.filter((f) => /^(src|tests|server|sdk|web-demo)\/.*\.[cm]?[jt]sx?$/.test(f) && !f.endsWith('.deno.ts'))
  if (has(/^(?:scripts\/test-projector-roundtrip\.cjs|resources\/ipad-bridge\/(?:backend\.js|projector-host\.cjs|bridge\.py)|\.github\/workflows\/verify-windows-projector\.yml)$/)) unitInputs.push('tests/main/ipadSync/projectorRoundtrip.test.ts')
  if (studyMarketBackend) unitInputs.push('tests/backend/studyMarket/policy.test.ts')
  if (paddleBillingBackend) unitInputs.push('tests/backend/paddleBilling/policy.test.ts', 'tests/backend/paddleBilling/service.test.ts')
  if (appleBillingBackend) unitInputs.push('tests/backend/appleBilling/service.test.ts')
  if (accountDeletionBackend) unitInputs.push('tests/backend/appleBilling/deletion.test.ts')
  if (dictionaryResources) unitInputs.push('src/main/features/learning/dictionary.ts')
  if (sharedAppearance) unitInputs.push('src/shared/theme.ts', 'src/renderer/src/features/courses/CourseSidebar.tsx', 'src/renderer/src/features/settings/AppearancePanel.tsx')
  if (has(/^(?:native|resources\/native)\/browser-import\/|^scripts\/(build-browser-import|verify-browser-import|build-native)\.mjs$/)) unitInputs.push('src/main/features/browser/import/index.ts')
  if (has(/^src\/renderer\/src\/features\/workspace\/.*\.css$/)) unitInputs.push('src/renderer/src/features/workspace/tabDrag.ts', 'src/renderer/src/features/workspace/tabDragSession.ts', 'src/renderer/src/features/workspace/tabDuplication.ts')
  // Runtime font files are loaded from disk, outside the TS import graph.
  if (has(/^resources\/fonts\//)) unitInputs.push('src/main/features/pdf/exportPdf.ts', 'src/main/features/canvas/exportBoardPdf.ts')
  const pdfChanges = files.filter(f => /^src\/renderer\/src\/features\/(pdf|ink)\//.test(f))
  const pdfZoomOnly = !full && pdfChanges.length > 0 && pdfChanges.every(f => /\/(PdfTab\.tsx|PdfPageView\.tsx|BufferedPdfCanvas\.tsx|pdf\.css|lib\/zoomInput\.ts)$/.test(f))
  const partial = new Map()
  if (pdfZoomOnly) partial.set('e2e/pdfTextbox.spec.ts', 'zooming in and back preserves normalized geometry')
  const infrastructure = files.filter(f => /^src\/(main\/(background\/|db\/|index\.ts|features\/(?:materials|search)\/)|preload\/index\.ts|renderer\/src\/(features\/workspace\/|stores\/workspaceStore))/.test(f))
  if (!full && infrastructure.length > 0 && infrastructure.every(f => f === 'src/preload/index.ts' || f === 'src/renderer/src/stores/workspaceStore.ts')) {
    partial.set('e2e/coursePerformance.spec.ts', '100 course switches retain the visible PDF')
  }
  const e2eGrep = partial.size ? [...e2e].map(f => partial.get(f) ?? f.replace('e2e/', '').replaceAll('.', '\\.')).join('|') : null

  return { e2eGrep, full, communityBackend, studyMarketBackend, paddleBillingBackend, appleBillingBackend, accountDeletionBackend, syncAccessBackend, types: [...types], scriptTests: [...scriptTests], pythonTests, unitInputs, e2e: [...e2e] }
}

function run(command, args, env = process.env) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawn.sync(command, args, { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

export function scriptTestCommand(test) {
  // SDK tests execute the compiled CLI. A clean CI checkout has no out/ tree.
  return test === 'scripts/test-plugin-sdk.mjs'
    ? ['pnpm', ['plugin:test']]
    : ['node', ['--test', test]]
}

export function main(args) {
  const baseFlag = args.indexOf('--base')
  const { base, files } = changedFiles(baseFlag < 0 ? undefined : args[baseFlag + 1])
  const plan = planChecks(files, args.includes('--full'))
  if (args.includes('--backend-plan')) { console.log(String(plan.communityBackend || plan.studyMarketBackend || plan.paddleBillingBackend || plan.appleBillingBackend || plan.accountDeletionBackend || plan.syncAccessBackend)); return }
  const readBefore = file => gitBlob(base, file), readAfter = file => readFileSync(file, 'utf8')
  const e2eFiles = plan.full ? files : materialChromeE2eFiles(tabPickerE2eFiles(communityE2eFiles(files, readBefore, readAfter), readBefore, readAfter), readBefore, readAfter)
  if (e2eFiles !== files) {
    const scoped = planChecks(e2eFiles)
    plan.e2e = scoped.e2e
    plan.e2eGrep = scoped.e2eGrep
  }
  plan.e2eGrep = materialChromeE2eGrep(plan, files, readBefore, readAfter)
  const nativeTabs = 'src/main/features/browser/nativeTabs.ts'
  if (!plan.full && e2eFiles.includes(nativeTabs) && onlySwipeRegistrationChanged(
    git('show', `${base}:${nativeTabs}`), readFileSync(nativeTabs, 'utf8')
  )) {
    const gesturePlan = planChecks(e2eFiles.filter(file => file !== nativeTabs).concat('src/main/features/browser/swipeNavigation.ts'))
    plan.e2e = gesturePlan.e2e
    plan.e2eGrep = gesturePlan.e2eGrep
  }
  console.log(JSON.stringify({ base, ...plan }, null, 2))
  if (args.includes('--plan')) return
  if (args.includes('--e2e')) {
    if (plan.e2e.length === 0) return
    const tests = plan.e2e.map((f) => f.replace(/^e2e\//, ''))
    run('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e', ...tests, ...(plan.e2eGrep ? ['--grep', plan.e2eGrep] : [])])
    return
  }
  for (const config of plan.types) run('pnpm', ['exec', 'tsc', '--noEmit', '-p', config])
  for (const test of plan.scriptTests.filter(existsSync)) run(...scriptTestCommand(test))
  for (const test of plan.pythonTests) run(process.platform === 'win32' ? 'python' : 'python3', ['-B', test])
  if (plan.communityBackend) run('node', ['tests/backend/community/run-local.mjs'])
  if (plan.studyMarketBackend) {
    run('deno', ['check', '--frozen', '--config', 'supabase/functions/deno.json', 'supabase/functions/study-market/index.ts', 'supabase/functions/study-market-webhook/index.ts', 'supabase/functions/study-market-cron/index.ts'])
    run('node', ['tests/backend/studyMarket/run-local.mjs'])
  }
  if (plan.paddleBillingBackend) {
    run('deno', ['check', '--frozen', '--config', 'supabase/functions/deno.json', ...PADDLE_BILLING_FUNCTIONS])
    run('node', ['tests/backend/paddleBilling/run-local.mjs'])
  }
  if (plan.appleBillingBackend) {
    run('deno', ['check', '--frozen', '--config', 'supabase/functions/deno.json', ...APPLE_BILLING_FUNCTIONS])
    run('deno', ['test', '--frozen', '--config', 'supabase/functions/deno.json', 'tests/backend/appleBilling/provider.deno.ts'])
  }
  if (plan.accountDeletionBackend) run('deno', ['check', '--frozen', '--config', 'supabase/functions/deno.json', ...ACCOUNT_DELETION_FUNCTIONS])
  if (plan.syncAccessBackend) run('node', ['tests/backend/syncAccess/run-local.mjs'], plan.accountDeletionBackend ? { ...process.env, BANDAL_ACCOUNT_DELETE_FULL_SCHEMA: '1' } : process.env)
  if (plan.full) {
    run('pnpm', ['deadcode'])
    run('pnpm', ['test'])
  } else if (plan.unitInputs.length > 0) {
    run('pnpm', ['exec', 'vitest', 'related', '--run', '--passWithNoTests', '--exclude', 'e2e/**', ...plan.unitInputs])
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
