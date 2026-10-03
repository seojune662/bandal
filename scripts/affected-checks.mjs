#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import spawn from 'cross-spawn'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** The previous tag, not the previous push: unreleased commits stay covered. */
export function changedFiles(base) {
  base ??= git('describe', '--tags', '--abbrev=0', 'HEAD^')
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
    }
  }
  // Adding this isolated browser preload leaves the app's build pipeline intact.
  if (files.has('electron.vite.config.ts')) {
    const before = git('show', `${base}:electron.vite.config.ts`)
    const after = readFileSync('electron.vite.config.ts', 'utf8')
    if (onlyBrowserGestureEntryChanged(before, after)) files.delete('electron.vite.config.ts')
  }
  return { base, files: [...files] }
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

export function planChecks(files, full = false) {
  const has = (pattern) => files.some((file) => pattern.test(file))
  // Global runtime/toolchain changes justify a broad check; routine features do not.
  full ||= has(/^(package\.json|pnpm-lock\.yaml|electron\.vite\.config\.ts|vitest\.config\.ts|tests\/setup\.ts)$/)
  const types = new Set()
  if (full || has(/^(src\/(main|preload|shared)\/|server\/|sdk\/|(?:marketplace|sdk)\.vite\.config\.ts|tsconfig\.node\.json)/)) types.add('tsconfig.node.json')
  if (full || has(/^(src\/(renderer|shared)\/|src\/preload\/browser|tsconfig\.web\.json)/)) types.add('tsconfig.web.json')
  if (full || has(/^(web-demo\/|src\/shared\/|web-demo\/tsconfig\.json)/)) types.add('web-demo/tsconfig.json')
  const scriptTests = new Set(files.filter((f) => /^scripts\/test-.*\.mjs$/.test(f)))
  if (has(/^(scripts\/(affected-checks|reuse-ci)\.mjs|\.github\/workflows\/)/)) scriptTests.add('scripts/test-affected-checks.mjs')
  if (has(/^scripts\/(upload-release-assets|lib\/release-assets|test-release-assets)\.mjs$/)) scriptTests.add('scripts/test-release-assets.mjs')
  const e2e = new Set(files.filter((f) => existsSync(f) && /^e2e\/[^/]+\.spec\.ts$/.test(f)))
  const browserSettings = /^src\/renderer\/src\/features\/settings\/(browser\/|(?:SavedLoginsSettings|BrowsingDataPanel)\.tsx$)/
  const sharedAppearance = files.some(file => !browserSettings.test(file) && file !== 'src/renderer/src/components/BandalMark.tsx' && /^(src\/shared\/(theme|appearance)\.ts|src\/renderer\/src\/(styles\/|app\/|components\/|features\/settings\/))/.test(file))
  if (sharedAppearance) {
    for (const spec of ['theme', 'sidebars', 'settingsShell', 'uiRedesign', 'tabDrag', 'favoritesDrag', 'materialsDrag', 'viewportMenus']) e2e.add(`e2e/${spec}.spec.ts`)
    scriptTests.add('scripts/check-contrast.mjs')
  }
  if (has(/^src\/renderer\/src\/features\/pdf\/(PdfToolbar|tools\/)/)) {
    for (const spec of ['pdfTextbox', 'eraser']) e2e.add(`e2e/${spec}.spec.ts`)
  }

  if (has(/^(src\/main\/features\/(pdf\/|canvas\/|presentation\/|pdfText|textboxPdfLayout)|src\/shared\/(types\/drawing|textBoxMetrics)|resources\/fonts\/|e2e\/helpers\/renderPdf)/)) e2e.add('e2e/pdfExport.spec.ts')
  if (has(/^src\/renderer\/src\/features\/(pdf|ink)\//)) e2e.add('e2e/pdfTextbox.spec.ts')
  if (has(/(renderInkSnapshot|pageImage)/i)) e2e.add('e2e/pageImageCopy.spec.ts')
  if (has(/(systemClipboard|noteImagePlugin|BufferedPdfCanvas|zoomInput)/)) e2e.add('e2e/interactionFixes.spec.ts')
  if (has(/(BrowserAddress|browserSearch|urlInput|useAddressSuggestions)/)) e2e.add('e2e/browserAddress.spec.ts')
  if (has(/^src\/.*\/browser\/|src\/preload\/browser|src\/main\/windows\/assistantWindow|src\/renderer\/src\/features\/assistant\//)) e2e.add('e2e/browserCompatibility.spec.ts')
  const browserImport = has(/^(src\/main\/features\/(browser\/(import\/|(?:profiles|historyRepo)\.ts$)|credentials\/)|src\/main\/ipc\/browserImportHandlers\.ts$|src\/renderer\/src\/features\/browser\/(BrowserImportDialog\.tsx|BrowserPanel\.tsx|browserImport\.css|loginBridge\.ts|browserFavorite\.ts|browserStartPageModel\.ts)$|src\/shared\/types\/(browserImport|browserProfile|credentials)\.ts$|(?:native|resources\/native)\/browser-import\/|scripts\/(build-browser-import|verify-browser-import|build-native)\.mjs$)/) || has(browserSettings)
  if (browserImport) {
    e2e.add('e2e/browserImport.spec.ts')
    e2e.add('e2e/browserCompatibility.spec.ts')
  }
  if (has(/^src\/(main\/(features\/(learning|workflowPacks)\/|ipc\/learningHandlers\.ts$)|renderer\/src\/features\/learning\/|shared\/(workflowPacks\/|types\/(learning|workflowPack)\.ts$|ipc\/learningContract\.ts$))/)) e2e.add('e2e/learning.spec.ts')
  if (has(/^src\/main\/(features\/materials\/(renameWithRetry|watcher)\.ts|background\/(materialsWatcher|watcherHost)\.ts)$/)) {
    e2e.add('e2e/learning.spec.ts')
    e2e.add('e2e/materialsDrag.spec.ts')
  }
  const workspace = has(/^(src\/renderer\/src\/(features\/workspace\/|stores\/workspaceStore\.ts$)|src\/shared\/tabs\.ts$)/)
  if (workspace) {
    for (const spec of ['tabDrag', 'favoritesDrag', 'materialsDrag', 'viewportMenus', 'coursePerformance']) e2e.add(`e2e/${spec}.spec.ts`)
  }
  if (has(/^src\/.*(calendar\/|appleCalendar\/|board\/|taskSchedule|calendarDate|types\/board)/)) {
    e2e.add('e2e/taskSchedule.spec.ts')
    e2e.add('e2e/appleCalendar.spec.ts')
  }
  if (has(/(useViewportBounds|BoardEditor|CalendarForm)/)) e2e.add('e2e/viewportMenus.spec.ts')
  if (has(/^src\/(main\/(background\/|db\/|index\.ts|features\/materials\/)|preload\/index\.ts|renderer\/src\/(features\/workspace\/|stores\/workspaceStore))/)) e2e.add('e2e/coursePerformance.spec.ts')
  if (has(/^src\/renderer\/src\/features\/notes\/(NoteTab|NoteToolbar|noteEditorPlugins|noteFormatting|nativeHistoryGuard)/)) e2e.add('e2e/noteToolbar.spec.ts')
  if (full) {
    for (const spec of ['pdfExport', 'browserAddress', 'browserCompatibility', 'browserImport', 'learning', 'tabDrag', 'favoritesDrag', 'materialsDrag', 'pageImageCopy', 'taskSchedule', 'appleCalendar', 'viewportMenus', 'coursePerformance']) {
      e2e.add(`e2e/${spec}.spec.ts`)
    }
  }
  // At least one launch for an installer with no feature-specific E2E coverage.
  if (has(/src\/(main\/(features\/(agent|agentTools|browserAgent|desktopAgent)|windows\/(assistantWindow|approvalWindow|screenSelection|overlay))|renderer\/src\/features\/(chat|assistantPanel|overlay)|shared\/(types\/(chat|aiAccess)|moonGeometry|brandMark|screenGeometry))/)) { e2e.add('e2e/chatUx.spec.ts'); e2e.add('e2e/assistantSidebar.spec.ts'); e2e.add('e2e/aiContext.spec.ts') }
  if (e2e.size === 0) e2e.add('e2e/startup.spec.ts')
  const unitInputs = files.filter((f) => /^(src|tests|server|sdk|web-demo)\/.*\.[cm]?[jt]sx?$/.test(f))
  if (sharedAppearance) unitInputs.push('src/shared/theme.ts', 'src/renderer/src/features/courses/CourseSidebar.tsx', 'src/renderer/src/features/settings/AppearancePanel.tsx')
  if (has(/^(?:native|resources\/native)\/browser-import\/|^scripts\/(build-browser-import|verify-browser-import|build-native)\.mjs$/)) unitInputs.push('src/main/features/browser/import/index.ts')
  if (has(/^src\/renderer\/src\/features\/workspace\/.*\.css$/)) unitInputs.push('src/renderer/src/features/workspace/tabDrag.ts', 'src/renderer/src/features/workspace/tabDragSession.ts', 'src/renderer/src/features/workspace/tabDuplication.ts')
  // Runtime font files are loaded from disk, outside the TS import graph.
  if (has(/^resources\/fonts\//)) unitInputs.push('src/main/features/pdf/exportPdf.ts', 'src/main/features/canvas/exportBoardPdf.ts')
  const pdfChanges = files.filter(f => /^src\/renderer\/src\/features\/(pdf|ink)\//.test(f))
  const pdfZoomOnly = !full && pdfChanges.length > 0 && pdfChanges.every(f => /\/(PdfTab\.tsx|PdfPageView\.tsx|BufferedPdfCanvas\.tsx|pdf\.css|lib\/zoomInput\.ts)$/.test(f))
  const partial = new Map()
  if (pdfZoomOnly) partial.set('e2e/pdfTextbox.spec.ts', 'zooming in and back preserves normalized geometry')
  const infrastructure = files.filter(f => /^src\/(main\/(background\/|db\/|index\.ts|features\/materials\/)|preload\/index\.ts|renderer\/src\/(features\/workspace\/|stores\/workspaceStore))/.test(f))
  if (!full && infrastructure.length > 0 && infrastructure.every(f => f === 'src/preload/index.ts' || f === 'src/renderer/src/stores/workspaceStore.ts')) {
    partial.set('e2e/coursePerformance.spec.ts', '100 course switches retain the visible PDF')
  }
  const e2eGrep = partial.size ? [...e2e].map(f => partial.get(f) ?? f.replace('e2e/', '').replaceAll('.', '\\.')).join('|') : null

  return { e2eGrep, full, types: [...types], scriptTests: [...scriptTests], unitInputs, e2e: [...e2e] }
}

function run(command, args) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawn.sync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

export function main(args) {
  const baseFlag = args.indexOf('--base')
  const { base, files } = changedFiles(baseFlag < 0 ? undefined : args[baseFlag + 1])
  const plan = planChecks(files, args.includes('--full'))
  console.log(JSON.stringify({ base, ...plan }, null, 2))
  if (args.includes('--plan')) return
  if (args.includes('--e2e')) {
    const tests = plan.e2e.map((f) => f.replace(/^e2e\//, ''))
    run('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e', ...tests, ...(plan.e2eGrep ? ['--grep', plan.e2eGrep] : [])])
    return
  }
  for (const config of plan.types) run('pnpm', ['exec', 'tsc', '--noEmit', '-p', config])
  for (const test of plan.scriptTests.filter(existsSync)) run('node', ['--test', test])
  if (plan.full) {
    run('pnpm', ['deadcode'])
    run('pnpm', ['test'])
  } else if (plan.unitInputs.length > 0) {
    run('pnpm', ['exec', 'vitest', 'related', '--run', '--passWithNoTests', '--exclude', 'e2e/**', ...plan.unitInputs])
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
