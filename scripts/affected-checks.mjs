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
  // Version-only releases do not change runtime dependencies.
  if (files.has('package.json')) {
    const before = JSON.parse(git('show', `${base}:package.json`))
    const after = JSON.parse(readFileSync('package.json', 'utf8'))
    delete before.version
    delete after.version
    if (JSON.stringify(before) === JSON.stringify(after)) files.delete('package.json')
  }
  return { base, files: [...files] }
}

export function planChecks(files, full = false) {
  const has = (pattern) => files.some((file) => pattern.test(file))
  // Global runtime/toolchain changes justify a broad check; routine features do not.
  full ||= has(/^(package\.json|pnpm-lock\.yaml|electron\.vite\.config\.ts|vitest\.config\.ts|tests\/setup\.ts)$/)
  const types = new Set()
  if (full || has(/^(src\/(main|preload|shared)\/|tsconfig\.node\.json)/)) types.add('tsconfig.node.json')
  if (full || has(/^(src\/(renderer|shared)\/|tsconfig\.web\.json)/)) types.add('tsconfig.web.json')
  if (full || has(/^(web-demo\/|src\/shared\/|web-demo\/tsconfig\.json)/)) types.add('web-demo/tsconfig.json')
  const scriptTests = new Set(files.filter((f) => /^scripts\/test-.*\.mjs$/.test(f)))
  if (has(/^(scripts\/(affected-checks|reuse-ci)\.mjs|\.github\/workflows\/)/)) scriptTests.add('scripts/test-affected-checks.mjs')
  if (has(/^scripts\/(upload-release-assets|lib\/release-assets|test-release-assets)\.mjs$/)) scriptTests.add('scripts/test-release-assets.mjs')
  const e2e = new Set(files.filter((f) => /^e2e\/[^/]+\.spec\.ts$/.test(f)))
  if (has(/^(src\/main\/features\/(pdf\/|canvas\/|presentation\/|pdfText|textboxPdfLayout)|src\/shared\/(types\/drawing|textBoxMetrics)|resources\/fonts\/|e2e\/helpers\/renderPdf)/)) e2e.add('e2e/pdfExport.spec.ts')
  if (has(/^src\/renderer\/src\/features\/(pdf|ink)\//)) e2e.add('e2e/pdfTextbox.spec.ts')
  if (has(/(renderInkSnapshot|pageImage|clipboard)/i)) e2e.add('e2e/pageImageCopy.spec.ts')
  if (has(/^src\/.*\/(browser\/|browserSearch)/)) e2e.add('e2e/browserAddress.spec.ts')
  if (has(/^src\/.*(calendar\/|appleCalendar\/|board\/|taskSchedule|calendarDate|types\/board)/)) {
    e2e.add('e2e/taskSchedule.spec.ts')
    e2e.add('e2e/appleCalendar.spec.ts')
  }
  if (has(/(useViewportBounds|BoardEditor|CalendarForm)/)) e2e.add('e2e/viewportMenus.spec.ts')
  if (has(/^src\/(main\/(background\/|db\/|index\.ts|features\/materials\/)|preload\/|renderer\/src\/(features\/workspace\/|stores\/workspaceStore))/)) e2e.add('e2e/coursePerformance.spec.ts')
  if (has(/^src\/renderer\/src\/features\/notes\//)) e2e.add('e2e/noteToolbar.spec.ts')
  if (full) {
    for (const spec of ['pdfExport', 'browserAddress', 'pageImageCopy', 'taskSchedule', 'appleCalendar', 'viewportMenus', 'coursePerformance']) {
      e2e.add(`e2e/${spec}.spec.ts`)
    }
  }
  // At least one launch for an installer with no feature-specific E2E coverage.
  if (e2e.size === 0) e2e.add('e2e/startup.spec.ts')
  const unitInputs = files.filter((f) => /^(src|tests)\/.*\.[cm]?[jt]sx?$/.test(f))
  // Runtime font files are loaded from disk, outside the TS import graph.
  if (has(/^resources\/fonts\//)) unitInputs.push('src/main/features/pdf/exportPdf.ts', 'src/main/features/canvas/exportBoardPdf.ts')
  return { full, types: [...types], scriptTests: [...scriptTests], unitInputs, e2e: [...e2e] }
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
    run('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e', ...tests])
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
