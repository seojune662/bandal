import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createExternalSourceLibrary } from '../../src/main/features/externalSources/library'

const roots: string[] = []
function workspace(): string { const path = realpathSync(mkdtempSync(join(tmpdir(), 'bandal-external-sources-'))); roots.push(path); return path }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('external sources picker grants', () => {
  test('browses only granted folders, sorts directories first and navigates to the parent', () => {
    const root = workspace()
    mkdirSync(join(root, '하위 폴더'))
    writeFileSync(join(root, '하위 폴더', '도표.png'), 'png')
    writeFileSync(join(root, '강의.pdf'), 'pdf')
    writeFileSync(join(root, '.private'), 'hidden')
    const library = createExternalSourceLibrary()
    const current = library.connectFolder(root)
    expect(current.parentId).toBeNull()
    expect(current.entries.map(entry => [entry.name, entry.kind])).toEqual([['하위 폴더', 'dir'], ['강의.pdf', 'pdf']])
    const nested = library.list(current.entries[0]!.id)
    expect(nested.parentId).toBe(current.id)
    expect(library.pathFor(nested.entries[0]!.id)).toBe(join(root, '하위 폴더', '도표.png'))
    expect(() => library.pathFor(join(root, '강의.pdf'))).toThrow('다시 선택')
  })

  test('revokes old folder tokens when connecting a new folder without dropping photo grants', () => {
    const root = workspace()
    const other = workspace()
    writeFileSync(join(root, 'old.png'), 'photo')
    const library = createExternalSourceLibrary()
    const folder = library.connectFolder(root)
    const photos = library.connectPhotos([join(root, 'old.png')])
    library.connectFolder(other)
    expect(() => library.pathFor(folder.entries[0]!.id)).toThrow('다시 선택')
    expect(library.pathFor(photos.entries[0]!.id)).toBe(join(root, 'old.png'))
    library.disconnect()
    expect(() => library.pathFor(photos.entries[0]!.id)).toThrow('다시 선택')
  })

  test.skipIf(process.platform === 'win32')('rejects symlink traversal and files replaced with outside symlinks after listing', () => {
    const root = workspace()
    const outside = workspace()
    writeFileSync(join(outside, 'private.png'), 'private')
    writeFileSync(join(root, 'image.png'), 'photo')
    symlinkSync(outside, join(root, 'outside'))
    const library = createExternalSourceLibrary()
    const folder = library.connectFolder(root)
    expect(folder.entries.map(entry => entry.name)).toEqual(['image.png'])
    rmSync(join(root, 'image.png'))
    symlinkSync(join(outside, 'private.png'), join(root, 'image.png'))
    expect(() => library.pathFor(folder.entries[0]!.id)).toThrow('폴더 밖')
  })

  test('bounds large folder listings and exposes truncation', () => {
    const root = workspace()
    for (let index = 0; index < 303; index++) writeFileSync(join(root, `${index}.md`), '')
    const location = createExternalSourceLibrary().connectFolder(root)
    expect(location.entries).toHaveLength(300)
    expect(location.truncated).toBe(true)
  })
})
