import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { extractLearningMaterialSource } from '../../../src/main/features/learning/materialSource'

describe('learning material source grounding', () => {
  let folder: string
  beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'bandal-learning-source-')) })
  afterEach(async () => { await rm(folder, { recursive: true, force: true }) })
  async function pdf(pages: string[]) {
    const document = await PDFDocument.create()
    const font = await document.embedFont(StandardFonts.Helvetica)
    for (const text of pages) { const page = document.addPage(); if (text) page.drawText(text, { x: 30, y: 700, font, size: 12 }) }
    const bytes = await document.save(), path = join(folder, 'source.PDF')
    await writeFile(path, bytes)
    return { path, bytes }
  }
  test('extracts real PDF pages with a raw-byte hash without canvas rendering or worker files', async () => {
    const { path, bytes } = await pdf(['The climate is changing. This is the first source page.', 'The second source page describes renewable energy.'])
    const result = await extractLearningMaterialSource(path)
    expect(result).toMatchObject({ truncated: false, contentHash: createHash('sha256').update(bytes).digest('hex') })
    expect(result?.pages).toEqual([
      { page: 1, text: 'The climate is changing. This is the first source page.' },
      { page: 2, text: 'The second source page describes renewable energy.' }
    ])
    expect(result?.text).toContain('## 페이지 2')
    expect((globalThis as Record<string, unknown>)['pdfjsWorker']).toHaveProperty('WorkerMessageHandler')
  })
  test('marks bounded extraction and only returns evidence from actually read pages', async () => {
    const { path } = await pdf(['First page contains the trusted quote.', 'Second page should not be read.'])
    const first = await extractLearningMaterialSource(path, { maxPages: 1 })
    expect(first?.truncated).toBe(true)
    expect(first?.pages).toHaveLength(1)
    expect(first?.text).not.toContain('Second page')
    const short = await extractLearningMaterialSource(path, { maxChars: 10 })
    expect(short?.truncated).toBe(true)
    expect(short?.pages).toEqual([{ page: 1, text: 'First page' }])
  })
  test('reads normal course text with consistent hashes and clear truncation', async () => {
    const path = join(folder, 'source.md'), text = 'A verified original source sentence.'
    await writeFile(path, text)
    expect(await extractLearningMaterialSource(path)).toEqual({ text, pages: [], truncated: false, contentHash: createHash('sha256').update(text).digest('hex') })
    expect(await extractLearningMaterialSource(path, { maxChars: 10 })).toMatchObject({ text: text.slice(0, 10), truncated: true })
    const unsupported = join(folder, 'image.png'); await writeFile(unsupported, 'image')
    expect(await extractLearningMaterialSource(unsupported)).toBeNull()
  })
  test('rejects image-only PDF evidence and cancelled extraction', async () => {
    const { path } = await pdf([''])
    await expect(extractLearningMaterialSource(path)).rejects.toThrow('텍스트')
    const controller = new AbortController(); controller.abort()
    await expect(extractLearningMaterialSource(path, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(extractLearningMaterialSource(path, { maxChars: 0 })).rejects.toThrow('범위')
  })
})
