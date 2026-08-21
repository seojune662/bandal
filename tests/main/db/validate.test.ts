import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ValidationError } from '../../../src/main/db/errors'
import {
  assertRealInside,
  resolveInside,
  resolveInsideReal
} from '../../../src/main/db/validate'

describe('real filesystem path validation', () => {
  let tempDir: string
  let root: string
  let outside: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bandal-validate-'))
    root = join(tempDir, 'course')
    outside = join(tempDir, 'outside')
    mkdirSync(root)
    mkdirSync(join(outside, 'sub'), { recursive: true })
    writeFileSync(join(outside, 'sub', 'secret.md'), 'secret')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('rejects an intermediate directory symlink that escapes the root', () => {
    symlinkSync(outside, join(root, 'linked'), 'dir')

    expect(() => resolveInsideReal(root, 'linked/sub/secret.md')).toThrow(
      ValidationError
    )
  })

  test('rejects a file symlink that escapes the root', () => {
    symlinkSync(join(outside, 'sub', 'secret.md'), join(root, 'secret.md'), 'file')

    expect(() => resolveInsideReal(root, 'secret.md')).toThrow(ValidationError)
  })

  test('allows normal files when the course root itself is a symlink', () => {
    const actualRoot = join(tempDir, 'actual-course')
    const linkedRoot = join(tempDir, 'linked-course')
    mkdirSync(actualRoot)
    writeFileSync(join(actualRoot, 'inside.md'), 'inside')
    symlinkSync(actualRoot, linkedRoot, 'dir')

    expect(resolveInsideReal(linkedRoot, 'inside.md')).toBe(
      join(linkedRoot, 'inside.md')
    )
  })

  test('checks a nonexistent destination using its longest existing ancestor', () => {
    mkdirSync(join(root, 'notes'))
    symlinkSync(outside, join(root, 'linked'), 'dir')
    const insideDestination = resolveInside(root, 'notes/new/deck.md')
    const escapedDestination = resolveInside(root, 'linked/new/deck.md')

    expect(assertRealInside(root, insideDestination)).toBe(insideDestination)
    expect(() => assertRealInside(root, escapedDestination)).toThrow(
      ValidationError
    )
  })

  test('rejects when the course root cannot be canonicalized', () => {
    const missingRoot = join(tempDir, 'missing-course')
    const destination = join(missingRoot, 'new.md')

    expect(() => assertRealInside(missingRoot, destination)).toThrow(
      ValidationError
    )
  })
})
