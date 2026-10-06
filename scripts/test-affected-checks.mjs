import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onlyVersionOrBrowserImportHookChanged, planChecks, scriptTestCommand } from './affected-checks.mjs'
import { matchingRun } from './reuse-ci.mjs'

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
  assert.deepEqual(plan.e2e, ['e2e/browserCompatibility.spec.ts', 'e2e/courseTabMove.spec.ts', 'e2e/tabMoveSessions.spec.ts', 'e2e/browserPlacement.spec.ts'])
})

test('AI links and connection fixes select their direct product regressions', () => {
  assert.deepEqual(planChecks(['src/renderer/src/features/ai/aiShortcutModel.ts']).e2e, ['e2e/aiConnections.spec.ts'])
  const runtime = planChecks(['src/main/features/agent/rpcSession.ts'])
  assert.ok(runtime.e2e.includes('e2e/aiConnections.spec.ts'))
  assert.ok(!runtime.e2e.includes('e2e/courseTabMove.spec.ts'))
  const workspace = planChecks(['src/renderer/src/features/workspace/panelContentHost.tsx'])
  assert.ok(workspace.e2e.includes('e2e/courseTabMove.spec.ts'))
  assert.ok(!workspace.e2e.includes('e2e/aiConnections.spec.ts'))
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
  assert.deepEqual(plan.e2e, ['e2e/browserCompatibility.spec.ts'])
  assert.ok(plan.types.includes('tsconfig.web.json'))
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
  assert.deepEqual(new Set(shell.e2e), new Set(['e2e/featureLauncher.spec.ts', 'e2e/sidebars.spec.ts', 'e2e/settingsShell.spec.ts', 'e2e/learningManagement.spec.ts', 'e2e/learningNavigation.spec.ts']))
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
    assert.deepEqual(new Set(plan.e2e), new Set(['e2e/browserImport.spec.ts', 'e2e/browserCompatibility.spec.ts']), file)
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
    assert.deepEqual(new Set(plan.e2e), new Set(['e2e/browserImport.spec.ts', 'e2e/browserCompatibility.spec.ts']), file)
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
    const specs = ['tabDrag', 'favoritesDrag', 'materialsDrag', 'viewportMenus', 'coursePerformance', 'courseTabMove', 'tabMoveSessions']
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
