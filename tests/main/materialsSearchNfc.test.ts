/**
 * Korean filename search across Unicode normalization forms.
 *
 * macOS `readdir` returns decomposed (NFD) filenames, while a query typed with
 * a Korean IME arrives composed (NFC). The old query compared bytes in SQL
 * (`instr(lower(rel_path), ?)`), so a student could see `과제1.pdf` in the tree
 * and get zero results searching for exactly that. Given the target user is a
 * Korean university student, that is most filenames in the app.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createMaterialsRepo, searchKey } from '../../src/main/features/materials/materialsRepo'
import { createTestDb, type TestDb } from './helpers/testDb'

const NFC_NAME = '과제1.pdf'.normalize('NFC')
const NFD_NAME = '과제1.pdf'.normalize('NFD')

describe('materials search normalization', () => {
  let ctx: TestDb
  let folder: string
  let repo: ReturnType<typeof createMaterialsRepo>

  beforeEach(() => {
    ctx = createTestDb()
    folder = mkdtempSync(join(tmpdir(), 'bandal-nfc-'))
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c1', '과목', 'course', '#000', ?, 0, 0, ?, ?)`
      )
      .run(folder, now, now)
    repo = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: () => folder,
      revealItem: () => {},
      trashItem: async () => {}
    })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('the two normalization forms really are different byte strings', () => {
    // Guards the premise: if these were equal the test below proves nothing.
    expect(NFC_NAME).not.toBe(NFD_NAME)
    expect(searchKey(NFC_NAME)).toBe(searchKey(NFD_NAME))
  })

  test('a file written NFD is found by an NFC query', () => {
    writeFileSync(join(folder, NFD_NAME), 'x')

    const hits = repo.search('c1', '과제')
    expect(hits.map((hit) => hit.name.normalize('NFC'))).toContain(NFC_NAME)
  })

  test('a file written NFC is found by an NFD query', () => {
    writeFileSync(join(folder, NFC_NAME), 'x')

    const hits = repo.search('c1', '과제'.normalize('NFD'))
    expect(hits).toHaveLength(1)
  })

  test('the stored path keeps the filesystem spelling so the file still opens', () => {
    writeFileSync(join(folder, NFD_NAME), 'hello')

    const [hit] = repo.search('c1', '과제')
    expect(hit).toBeDefined()
    // Reading through the returned relPath must work — normalizing what we
    // persist would make the file findable and then unopenable.
    expect(() => repo.readFile('c1', hit!.relPath)).not.toThrow()
  })

  test('nested Korean folders match too', () => {
    mkdirSync(join(folder, '1주차'.normalize('NFD')))
    writeFileSync(join(folder, '1주차'.normalize('NFD'), NFD_NAME), 'x')

    expect(repo.search('c1', '1주차')).toHaveLength(1)
  })

  test('ascii search is unaffected', () => {
    writeFileSync(join(folder, 'Chap1.pdf'), 'x')

    expect(repo.search('c1', 'chap')).toHaveLength(1)
  })
})
