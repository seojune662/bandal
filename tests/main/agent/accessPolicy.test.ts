import { expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appPermissionAllowed, cliPermissionAllowed, permissionFingerprint } from '../../../src/main/features/agent/accessPolicy'
import { DEFAULT_AI_ACCESS } from '../../../src/shared/types/aiAccess'
test('the restricted automatic choice still contains reads and requests writes and shell access', () => {
  const root = mkdtempSync(join(tmpdir(), 'bandal-policy-')), course = join(root, 'course'), outside = join(root, 'outside')
  mkdirSync(course); mkdirSync(outside); symlinkSync(outside, join(course, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  try {
    const restricted = { ...DEFAULT_AI_ACCESS, mode: 'auto' as const }
    expect(cliPermissionAllowed(restricted, 'Read', { path: 'notes.md' }, course)).toBe(true)
    for (const path of ['../outside/private.md', 'linked/private.md']) expect(cliPermissionAllowed(restricted, 'Read', { path }, course)).toBe(false)
    expect(cliPermissionAllowed(restricted, 'Write', { path: 'notes.md' }, course)).toBe(false)
    expect(cliPermissionAllowed(restricted, 'Bash', { command: 'python convert.py' }, course)).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('default access handles files, skills, commands and browser work without a confirmation', () => {
  for (const [tool, input] of [['Read', { path: '/skills/pdf/SKILL.md' }], ['Bash', { command: 'python convert.py' }], ['fileChange', { paths: ['/course/notes.md'] }], ['추가 접근', { permissions: { network: { enabled: true } } }]] as const) {
    expect(cliPermissionAllowed(DEFAULT_AI_ACCESS, tool, input, '/course')).toBe(true)
  }
  for (const tool of ['browser_access', 'lms_read', 'create_note', 'edit_docx_text']) expect(appPermissionAllowed(DEFAULT_AI_ACCESS, tool, true)).toBe(true)
  expect(appPermissionAllowed(DEFAULT_AI_ACCESS, 'desktop_screenshot', true)).toBe(false)
  expect(appPermissionAllowed(DEFAULT_AI_ACCESS, 'create_note', false)).toBe(false)
  expect(cliPermissionAllowed(DEFAULT_AI_ACCESS, 'serviceAuthorization', {}, '/course')).toBe(false)
  expect(cliPermissionAllowed({ ...DEFAULT_AI_ACCESS, mode: 'ask' }, 'Bash', {}, '/course')).toBe(false)
  expect(cliPermissionAllowed({ ...DEFAULT_AI_ACCESS, scope: { ...DEFAULT_AI_ACCESS.scope, course: false } }, 'Bash', {}, '/course')).toBe(false)
  expect(cliPermissionAllowed({ ...DEFAULT_AI_ACCESS, scope: { ...DEFAULT_AI_ACCESS.scope, course: false } }, 'WebSearch', {}, '/course')).toBe(true)
  expect(cliPermissionAllowed({ ...DEFAULT_AI_ACCESS, scope: { ...DEFAULT_AI_ACCESS.scope, browser: false } }, 'WebSearch', {}, '/course')).toBe(false)
})
test('operation identity ignores transport retries but preserves actual command changes', () => {
  expect(permissionFingerprint({ command: 'rm test.txt', itemId: 'a', turnId: 'a' })).toBe(permissionFingerprint({ turnId: 'b', itemId: 'b', command: 'rm test.txt' }))
  expect(permissionFingerprint({ command: 'rm a.txt' })).not.toBe(permissionFingerprint({ command: 'rm b.txt' }))
})
