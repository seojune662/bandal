import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planChecks } from './affected-checks.mjs'
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


test('login and download changes select compatibility rather than omnibox E2E', () => {
  const plan = planChecks(['src/main/features/browser/downloads.ts', 'src/renderer/src/features/browser/BrowserGuestView.tsx'])
  assert.deepEqual(plan.e2e, ['e2e/browserCompatibility.spec.ts'])
})

test('native image clipboard does not repeat PDF image export checks', () => {
  assert.deepEqual(planChecks(['src/main/features/systemClipboard.ts']).e2e, ['e2e/interactionFixes.spec.ts'])
})
test('PDF buffering runs continuous zoom and drawing geometry, without unrelated textbox editing', () => {
  const plan = planChecks(['src/renderer/src/features/pdf/BufferedPdfCanvas.tsx', 'src/renderer/src/features/pdf/PdfTab.tsx'])
  assert.deepEqual(plan.e2e, ['e2e/pdfTextbox.spec.ts', 'e2e/interactionFixes.spec.ts'])
  assert.match(plan.e2eGrep, /zooming in and back/)
  assert.equal(planChecks(['src/renderer/src/features/ink/InkLayer.tsx']).e2eGrep, null)
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
