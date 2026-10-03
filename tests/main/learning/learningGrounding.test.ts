import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createLearningGrounding } from '../../../src/main/features/learning/learningGrounding'
import type { LearningSourceRef } from '../../../src/shared/types/learning'

describe('native learning evidence', () => {
  let root: string
  const binding = { courseId: 'course', rootRelPath: 'learning' }
  let grounding: ReturnType<typeof createLearningGrounding>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bandal-grounding-'))
    await mkdir(join(root, 'learning'))
    grounding = createLearningGrounding(() => root)
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))
  test('binds course and portable project citations to real quotes and exact bytes', async () => {
    await writeFile(join(root, 'lesson.md'), 'The climate\nis changing.')
    const ref: LearningSourceRef = { kind: 'material', pathScope: 'course', relPath: 'lesson.md', quote: 'climate is changing.' }
    await grounding.validateMaterial(binding, ref)
    expect(ref.contentHash).toHaveLength(64)
    expect(await grounding.resolve(binding, ref)).toEqual({ relPath: 'lesson.md', missing: false })
    await writeFile(join(root, 'lesson.md'), 'The climate has changed.')
    expect(await grounding.resolve(binding, ref)).toEqual({ relPath: null, missing: true })
    await expect(grounding.validateMaterial(binding, ref)).rejects.toThrow('달라졌어요')
    await writeFile(join(root, 'learning', 'note.md'), 'A retained source sentence.')
    await grounding.validateMaterial(binding, { kind: 'material', relPath: 'note.md', quote: 'source sentence' })
    await expect(grounding.validateMaterial(binding, { kind: 'material', relPath: 'note.md', quote: 'invented source' })).rejects.toThrow('근거 문장')
  })
  test('rejects traversal and escaping symlinks even when a quote matches', async () => {
    await expect(grounding.material(binding, '../outside.md')).rejects.toThrow()
    await symlink(tmpdir(), join(root, 'outside'))
    await expect(grounding.material(binding, 'outside/some.md')).rejects.toThrow('outside')
  })
  test('checks the cited PDF page rather than accepting a sentence from another page', async () => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
    for (const text of ['First page evidence.', 'Second page evidence.']) pdf.addPage().drawText(text, { font })
    await writeFile(join(root, 'lesson.pdf'), await pdf.save())
    const ref: LearningSourceRef = { kind: 'material', pathScope: 'course', relPath: 'lesson.pdf', quote: 'Second page evidence.', page: 1 }
    await expect(grounding.validateMaterial(binding, ref)).rejects.toThrow('근거 문장')
    ref.page = 2
    await grounding.validateMaterial(binding, ref)
    expect(ref.contentHash).toHaveLength(64)
  })
})
