import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  folderDisplayName,
  folderState,
  isFolderUsable,
  normalizeFolderPath
} from '../../src/main/features/courses'
import { ValidationError } from '../../src/main/db/errors'

describe('courseFolder', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bandal-folder-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('normalizeFolderPath', () => {
    test('resolves "." and ".." segments to a canonical absolute path', () => {
      // Arrange
      const nested = join(dir, 'a', 'b')
      mkdirSync(nested, { recursive: true })

      // Act
      const normalized = normalizeFolderPath(join(dir, 'a', '..', 'a', '.', 'b'))

      // Assert
      expect(normalized).toBe(normalizeFolderPath(nested))
    })

    test('resolves a symlinked folder to its real path', () => {
      // Arrange
      const real = join(dir, 'real')
      const link = join(dir, 'link')
      mkdirSync(real)
      symlinkSync(real, link, 'dir')

      // Act / Assert — both spellings collapse to the same canonical path.
      expect(normalizeFolderPath(link)).toBe(normalizeFolderPath(real))
    })

    test('keeps the lexical path when it does not exist on disk', () => {
      // Act
      const normalized = normalizeFolderPath(join(dir, 'gone'))

      // Assert
      expect(normalized).toBe(resolve(join(dir, 'gone')))
    })

    test('strips a trailing separator', () => {
      // Act / Assert
      expect(normalizeFolderPath(`${dir}/`)).toBe(normalizeFolderPath(dir))
    })

    test('rejects a relative path', () => {
      // Act / Assert
      expect(() => normalizeFolderPath('relative/path')).toThrow(ValidationError)
    })

    test('rejects an empty path', () => {
      // Act / Assert
      expect(() => normalizeFolderPath('   ')).toThrow(ValidationError)
    })

    test('rejects a path containing a null byte', () => {
      // Act / Assert
      expect(() => normalizeFolderPath(`${dir}/a\u0000b`)).toThrow(ValidationError)
    })
  })

  describe('folderState', () => {
    test('reports "ok" for a readable directory', () => {
      // Act / Assert
      expect(folderState(dir)).toBe('ok')
      expect(isFolderUsable(dir)).toBe(true)
    })

    test('reports "missing" when the path does not exist', () => {
      // Act / Assert
      expect(folderState(join(dir, 'nope'))).toBe('missing')
      expect(isFolderUsable(join(dir, 'nope'))).toBe(false)
    })

    test('reports "not-a-directory" for a regular file', () => {
      // Arrange
      const file = join(dir, 'file.txt')
      writeFileSync(file, 'x')

      // Act / Assert
      expect(folderState(file)).toBe('not-a-directory')
    })

    test('reports "unreadable" when the directory cannot be listed', () => {
      // Arrange — root ignores mode bits, so this case is unobservable there.
      if (typeof process.getuid === 'function' && process.getuid() === 0) return
      const locked = join(dir, 'locked')
      mkdirSync(locked)
      chmodSync(locked, 0o000)

      try {
        // Act / Assert
        expect(folderState(locked)).toBe('unreadable')
      } finally {
        chmodSync(locked, 0o700)
      }
    })
  })

  describe('folderDisplayName', () => {
    test('returns the basename', () => {
      // Act / Assert
      expect(folderDisplayName('/Users/me/Documents/자료구조')).toBe('자료구조')
    })

    test('falls back to the path for a root folder', () => {
      // Act / Assert
      expect(folderDisplayName('/')).toBe('/')
    })
  })
})
