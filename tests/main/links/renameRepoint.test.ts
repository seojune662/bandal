import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMaterialLink, parseMaterialLink } from '../../../src/main/features/link/materialLink'
import { createLinkIndex, type LinkIndex } from '../../../src/main/features/links/linkIndex'
import {
  collectRepointNoteCandidates,
  repointMaterialPath,
  type RepointMaterialPathResult
} from '../../../src/main/features/links/renameRepoint'
import { createMaterialsRepo } from '../../../src/main/features/materials'
import { createNotesRepo } from '../../../src/main/features/notes'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'course-1'
const NOW = '2026-08-27T00:00:00.000Z'

function materialHref(relPath: string, annotationId = 'annotation-1'): string {
  return createMaterialLink({ relPath, page: 3, annotationId })
}

function pdfDescriptor(relPath: string): object {
  return { kind: 'pdf', payload: { courseId: COURSE_ID, relPath } }
}

function noteDescriptor(relPath: string): object {
  return { kind: 'note', payload: { courseId: COURSE_ID, relPath } }
}

function payloadRelPath(json: string): string | undefined {
  return (JSON.parse(json) as { payload?: { relPath?: string } }).payload?.relPath
}

describe('rename path repointing', () => {
  let ctx: TestDb
  let courseFolder: string
  let index: LinkIndex

  beforeEach(() => {
    ctx = createTestDb()
    courseFolder = join(ctx.dir, 'course')
    mkdirSync(courseFolder)
    ctx.db.prepare(
      `INSERT INTO courses
         (id, name, slug, color, folder_path, archived, sort_order,
          created_at, updated_at)
       VALUES (?, '운영체제', ?, 'gold', ?, 0, 0, ?, ?)`
    ).run(COURSE_ID, COURSE_ID, courseFolder, NOW, NOW)
    index = createLinkIndex({
      db: ctx.db,
      getCourseFolder: () => courseFolder
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ctx.cleanup()
  })

  function seedPathRows(relPath: string): void {
    ctx.db.prepare(
      `INSERT INTO annotations
         (id, course_id, rel_path, page, color, rects_json, anchor_json,
          created_at, updated_at)
       VALUES ('annotation-1', ?, ?, 3, 'yellow', '[]', '{}', ?, ?)`
    ).run(COURSE_ID, relPath, NOW, NOW)
    ctx.db.prepare(
      `INSERT INTO pdf_drawings
         (id, course_id, rel_path, page, kind, data_json, style_json,
          created_at, updated_at)
       VALUES ('drawing-1', ?, ?, 3, 'pen', '{}', '{}', ?, ?)`
    ).run(COURSE_ID, relPath, NOW, NOW)
    ctx.db.prepare(
      `INSERT INTO media_progress
         (course_id, rel_path, position_sec, playback_rate, updated_at)
       VALUES (?, ?, 12, 1, ?)`
    ).run(COURSE_ID, relPath, NOW)
  }

  function seedFavorite(
    id: string,
    relPath: string,
    courseId: string | null = COURSE_ID
  ): void {
    ctx.db.prepare(
      `INSERT INTO favorites
         (id, course_id, label, descriptor_json, sort_order, created_at, updated_at)
       VALUES (?, ?, '자료', ?, 0, ?, ?)`
    ).run(id, courseId, JSON.stringify(pdfDescriptor(relPath)), NOW, NOW)
  }

  function seedMaterialLink(
    id: string,
    sourceRelPath: string,
    targetRelPath: string,
    targetJson = JSON.stringify(pdfDescriptor(targetRelPath))
  ): void {
    ctx.db.prepare(
      `INSERT INTO material_links
         (id, course_id, source_json, target_json, label, created_at)
       VALUES (?, ?, ?, ?, '참조', ?)`
    ).run(
      id,
      COURSE_ID,
      JSON.stringify(noteDescriptor(sourceRelPath)),
      targetJson,
      NOW
    )
  }

  function relPath(table: 'annotations' | 'pdf_drawings' | 'media_progress'): string {
    return (ctx.db
      .prepare(`SELECT rel_path FROM ${table} WHERE course_id = ?`)
      .get(COURSE_ID) as { rel_path: string }).rel_path
  }

  function favoriteJson(id: string): string {
    return (ctx.db
      .prepare('SELECT descriptor_json FROM favorites WHERE id = ?')
      .get(id) as { descriptor_json: string }).descriptor_json
  }

  function materialLinkJson(id: string): { source_json: string; target_json: string } {
    return ctx.db
      .prepare('SELECT source_json, target_json FROM material_links WHERE id = ?')
      .get(id) as { source_json: string; target_json: string }
  }

  test('a file rename keeps SQL rows, JSON descriptors, and note hrefs alive', () => {
    writeFileSync(join(courseFolder, 'old.pdf'), 'pdf')
    writeFileSync(
      join(courseFolder, 'study.md'),
      `[인용](${materialHref('old.pdf')})\n[다른 자료](${materialHref('keep.pdf', 'keep')})\n`
    )
    writeFileSync(join(courseFolder, 'keep.pdf'), 'pdf')
    index.forMaterial(COURSE_ID, 'old.pdf')
    seedPathRows('old.pdf')
    seedFavorite('favorite-1', 'old.pdf')
    seedFavorite('favorite-global', 'old.pdf', null)
    seedMaterialLink('link-1', 'study.md', 'old.pdf')

    let repointed: RepointMaterialPathResult | undefined
    const materials = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: () => courseFolder,
      revealItem: () => undefined,
      trashItem: async () => undefined,
      onPathChanged: (change) => {
        repointed = repointMaterialPath({ ...change, db: ctx.db, courseFolder })
      }
    })

    expect(
      materials.rename({ courseId: COURSE_ID, relPath: 'old.pdf', newName: 'new.pdf' })
    ).toEqual({ relPath: 'new.pdf' })

    expect(repointed?.updatedRows).toEqual({
      annotations: 1,
      pdf_drawings: 1,
      media_progress: 1,
      favorites: 2,
      material_links: 1
    })
    expect(relPath('annotations')).toBe('new.pdf')
    expect(relPath('pdf_drawings')).toBe('new.pdf')
    expect(relPath('media_progress')).toBe('new.pdf')
    expect(payloadRelPath(favoriteJson('favorite-1'))).toBe('new.pdf')
    expect(payloadRelPath(favoriteJson('favorite-global'))).toBe('new.pdf')
    expect(payloadRelPath(materialLinkJson('link-1').target_json)).toBe('new.pdf')
    const markdown = readFileSync(join(courseFolder, 'study.md'), 'utf8')
    expect(markdown).toContain(materialHref('new.pdf'))
    expect(markdown).toContain(materialHref('keep.pdf', 'keep'))
    expect(index.forMaterial(COURSE_ID, 'new.pdf').notes).toEqual([
      { ref: 'study.md', label: 'study.md', page: 3 }
    ])
  })

  test('a folder move rewrites child prefixes and a moved self-reference', () => {
    mkdirSync(join(courseFolder, 'unit%_'))
    mkdirSync(join(courseFolder, 'archive'))
    writeFileSync(join(courseFolder, 'unit%_', 'paper.pdf'), 'pdf')
    writeFileSync(
      join(courseFolder, 'unit%_', 'self.md'),
      `# Self\n\n[나 자신](${materialHref('unit%_/self.md')})\n`
    )
    index.forMaterial(COURSE_ID, 'unit%_/self.md')
    seedPathRows('unit%_/paper.pdf')
    seedFavorite('favorite-1', 'unit%_/self.md')
    seedMaterialLink('link-1', 'unit%_/self.md', 'unit%_/paper.pdf')

    const materials = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: () => courseFolder,
      revealItem: () => undefined,
      trashItem: async () => undefined,
      onPathChanged: (change) => {
        repointMaterialPath({ ...change, db: ctx.db, courseFolder })
      }
    })

    expect(
      materials.move({
        courseId: COURSE_ID,
        fromRelPath: 'unit%_',
        toDirRelPath: 'archive'
      })
    ).toEqual({ relPath: 'archive/unit%_' })

    expect(relPath('annotations')).toBe('archive/unit%_/paper.pdf')
    expect(relPath('pdf_drawings')).toBe('archive/unit%_/paper.pdf')
    expect(relPath('media_progress')).toBe('archive/unit%_/paper.pdf')
    expect(payloadRelPath(favoriteJson('favorite-1'))).toBe('archive/unit%_/self.md')
    const link = materialLinkJson('link-1')
    expect(payloadRelPath(link.source_json)).toBe('archive/unit%_/self.md')
    expect(payloadRelPath(link.target_json)).toBe('archive/unit%_/paper.pdf')
    const movedNote = readFileSync(
      join(courseFolder, 'archive', 'unit%_', 'self.md'),
      'utf8'
    )
    expect(movedNote).toContain(materialHref('archive/unit%_/self.md'))
    expect(index.forMaterial(COURSE_ID, 'archive/unit%_/self.md').notes[0]?.ref).toBe(
      'archive/unit%_/self.md'
    )
  })

  test('NFC folder matching repairs NFD-prefixed SQL, JSON, and href spellings', () => {
    const fromNfc = 'café'.normalize('NFC')
    const storedNfd = fromNfc.normalize('NFD')
    const storedTarget = `${storedNfd}/paper.pdf`
    mkdirSync(join(courseFolder, storedNfd))
    writeFileSync(join(courseFolder, storedNfd, 'paper.pdf'), 'pdf')
    writeFileSync(
      join(courseFolder, 'unicode.md'),
      `[인용](${materialHref(storedTarget)})\n`
    )
    index.forMaterial(COURSE_ID, `${fromNfc}/paper.pdf`)
    seedPathRows(storedTarget)
    seedFavorite('favorite-1', storedTarget)
    seedMaterialLink('link-1', 'unicode.md', storedTarget)
    const candidateNoteRelPaths = collectRepointNoteCandidates({
      db: ctx.db,
      courseId: COURSE_ID,
      fromRelPath: fromNfc,
      toRelPath: 'renamed',
      isDirectory: true
    })

    renameSync(join(courseFolder, storedNfd), join(courseFolder, 'renamed'))
    const result = repointMaterialPath({
      db: ctx.db,
      courseFolder,
      courseId: COURSE_ID,
      fromRelPath: fromNfc,
      toRelPath: 'renamed',
      isDirectory: true,
      candidateNoteRelPaths
    })

    expect(result.updatedRows.annotations).toBe(1)
    expect(result.updatedRows.pdf_drawings).toBe(1)
    expect(result.updatedRows.media_progress).toBe(1)
    expect(relPath('annotations')).toBe('renamed/paper.pdf')
    expect(payloadRelPath(favoriteJson('favorite-1'))).toBe('renamed/paper.pdf')
    expect(payloadRelPath(materialLinkJson('link-1').target_json)).toBe(
      'renamed/paper.pdf'
    )
    expect(readFileSync(join(courseFolder, 'unicode.md'), 'utf8')).toContain(
      materialHref('renamed/paper.pdf')
    )
  })

  test('notesRepo returns the repointed body when a renamed note cites itself', () => {
    writeFileSync(
      join(courseFolder, 'old.md'),
      `# Old\n\n[나 자신](${materialHref('old.md')})\n`
    )
    index.forMaterial(COURSE_ID, 'old.md')
    const notes = createNotesRepo({
      getCourseFolder: () => courseFolder,
      onPathChanged: (change) => {
        repointMaterialPath({ ...change, db: ctx.db, courseFolder })
      }
    })

    const result = notes.rename({
      courseId: COURSE_ID,
      relPath: 'old.md',
      newName: 'new.md'
    })

    expect(result.markdown).toContain(materialHref('new.md'))
    expect(parseMaterialLink(materialHref('new.md'))?.relPath).toBe('new.md')
    expect(readFileSync(join(courseFolder, 'new.md'), 'utf8')).toBe(result.markdown)
  })

  test('one read-only note fails without stopping the remaining rewrites', () => {
    writeFileSync(join(courseFolder, 'old.pdf'), 'pdf')
    writeFileSync(join(courseFolder, 'good.md'), `[좋음](${materialHref('old.pdf')})\n`)
    writeFileSync(join(courseFolder, 'locked.md'), `[잠김](${materialHref('old.pdf')})\n`)
    chmodSync(join(courseFolder, 'locked.md'), 0o444)
    index.forMaterial(COURSE_ID, 'old.pdf')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    renameSync(join(courseFolder, 'old.pdf'), join(courseFolder, 'new.pdf'))
    const result = repointMaterialPath({
      db: ctx.db,
      courseFolder,
      courseId: COURSE_ID,
      fromRelPath: 'old.pdf',
      toRelPath: 'new.pdf',
      isDirectory: false
    })

    expect(result.rewrittenNotes).toEqual(['good.md'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('locked.md: note is read-only')
    expect(readFileSync(join(courseFolder, 'good.md'), 'utf8')).toContain(
      materialHref('new.pdf')
    )
    expect(readFileSync(join(courseFolder, 'locked.md'), 'utf8')).toContain(
      materialHref('old.pdf')
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to rewrite note "locked.md"')
    )
  })

  test('invalid JSON rows are warned and left byte-for-byte unchanged', () => {
    writeFileSync(join(courseFolder, 'new.pdf'), 'pdf')
    seedFavorite('favorite-1', 'old.pdf')
    const badFavorite = '{"kind":"pdf","payload":{"relPath":7}}'
    ctx.db.prepare(
      `INSERT INTO favorites
         (id, course_id, label, descriptor_json, sort_order, created_at, updated_at)
       VALUES ('favorite-bad', ?, '깨짐', ?, 1, ?, ?)`
    ).run(COURSE_ID, badFavorite, NOW, NOW)
    const badTarget = '{not-json'
    seedMaterialLink('link-bad', 'study.md', 'old.pdf', badTarget)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = repointMaterialPath({
      db: ctx.db,
      courseFolder,
      courseId: COURSE_ID,
      fromRelPath: 'old.pdf',
      toRelPath: 'new.pdf',
      isDirectory: false
    })

    expect(result.updatedRows.favorites).toBe(1)
    expect(result.updatedRows.material_links).toBe(0)
    expect(favoriteJson('favorite-bad')).toBe(badFavorite)
    expect(materialLinkJson('link-bad').target_json).toBe(badTarget)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  test('a late SQL failure rolls every table and JSON update back together', () => {
    writeFileSync(join(courseFolder, 'new.pdf'), 'pdf')
    seedPathRows('old.pdf')
    seedFavorite('favorite-1', 'old.pdf')
    seedMaterialLink('link-1', 'study.md', 'old.pdf')
    ctx.db.exec(
      `CREATE TRIGGER fail_material_link_repoint
       BEFORE UPDATE ON material_links
       BEGIN
         SELECT RAISE(ABORT, 'injected material_links failure');
       END;`
    )

    expect(() => repointMaterialPath({
      db: ctx.db,
      courseFolder,
      courseId: COURSE_ID,
      fromRelPath: 'old.pdf',
      toRelPath: 'new.pdf',
      isDirectory: false
    })).toThrow('injected material_links failure')

    expect(relPath('annotations')).toBe('old.pdf')
    expect(relPath('pdf_drawings')).toBe('old.pdf')
    expect(relPath('media_progress')).toBe('old.pdf')
    expect(payloadRelPath(favoriteJson('favorite-1'))).toBe('old.pdf')
    expect(payloadRelPath(materialLinkJson('link-1').target_json)).toBe('old.pdf')
  })

  test('repository hook exceptions are warned without falsifying renames', () => {
    writeFileSync(join(courseFolder, 'material.pdf'), 'pdf')
    writeFileSync(join(courseFolder, 'note.md'), '# Note\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failingHook = (): never => {
      throw new Error('injected hook failure')
    }
    const materials = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: () => courseFolder,
      revealItem: () => undefined,
      trashItem: async () => undefined,
      onPathChanged: failingHook
    })
    const notes = createNotesRepo({
      getCourseFolder: () => courseFolder,
      onPathChanged: failingHook
    })

    expect(materials.rename({
      courseId: COURSE_ID,
      relPath: 'material.pdf',
      newName: 'renamed.pdf'
    })).toEqual({ relPath: 'renamed.pdf' })
    expect(notes.rename({
      courseId: COURSE_ID,
      relPath: 'note.md',
      newName: 'renamed-note.md'
    }).relPath).toBe('renamed-note.md')

    expect(existsSync(join(courseFolder, 'renamed.pdf'))).toBe(true)
    expect(existsSync(join(courseFolder, 'renamed-note.md'))).toBe(true)
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
