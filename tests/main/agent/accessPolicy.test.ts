import { expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliPermissionAllowed, permissionFingerprint } from '../../../src/main/features/agent/accessPolicy'
import { DEFAULT_AI_ACCESS } from '../../../src/shared/types/aiAccess'
test('automatic access never grants writes, traversal, unknown commands or symlink escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'bandal-policy-')), course = join(root, 'course'), outside = join(root, 'outside')
  mkdirSync(course); mkdirSync(outside); symlinkSync(outside, join(course, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  try {
    expect(cliPermissionAllowed(DEFAULT_AI_ACCESS, 'Read', { path: 'notes.md' }, course)).toBe(true)
    for (const path of ['../outside/private.md', 'linked/private.md']) expect(cliPermissionAllowed({ ...DEFAULT_AI_ACCESS, mode: 'full' }, 'Read', { path }, course)).toBe(false)
    expect(cliPermissionAllowed(DEFAULT_AI_ACCESS, 'Write', { path: 'notes.md' }, course)).toBe(false)
    expect(cliPermissionAllowed({ ...DEFAULT_AI_ACCESS, mode: 'full' }, 'Bash', { command: 'rm -rf .' }, course)).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('operation identity ignores transport retries but preserves actual command changes', () => {
  expect(permissionFingerprint({ command: 'rm test.txt', itemId: 'a', turnId: 'a' })).toBe(permissionFingerprint({ turnId: 'b', itemId: 'b', command: 'rm test.txt' }))
  expect(permissionFingerprint({ command: 'rm a.txt' })).not.toBe(permissionFingerprint({ command: 'rm b.txt' }))
})
