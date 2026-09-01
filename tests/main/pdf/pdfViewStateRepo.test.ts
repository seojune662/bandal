import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createPdfViewStateRepo,
  type PdfViewStateRepo
} from '../../../src/main/features/pdf/pdfViewStateRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('pdfViewStateRepo', () => {
  let ctx: TestDb
  let repo: PdfViewStateRepo

  beforeEach(() => {
    ctx = createTestDb()
    repo = createPdfViewStateRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('returns null before anything was saved', () => {
    expect(repo.get('c1', '강의.pdf')).toBeNull()
  })

  test('upserts and reads back the last viewed page and zoom', () => {
    repo.set({ courseId: 'c1', relPath: '강의.pdf', page: 42, zoom: 1.3 })
    repo.set({ courseId: 'c1', relPath: '강의.pdf', page: 187, zoom: 0.8 })

    const saved = repo.get('c1', '강의.pdf')
    expect(saved?.page).toBe(187)
    expect(saved?.zoom).toBeCloseTo(0.8)
  })

  test('keys by (course, file) independently', () => {
    repo.set({ courseId: 'c1', relPath: 'a.pdf', page: 3, zoom: 1 })
    repo.set({ courseId: 'c2', relPath: 'a.pdf', page: 9, zoom: 1 })

    expect(repo.get('c1', 'a.pdf')?.page).toBe(3)
    expect(repo.get('c2', 'a.pdf')?.page).toBe(9)
  })

  test('sanitizes nonsense pages and zooms instead of persisting them', () => {
    repo.set({ courseId: 'c1', relPath: 'a.pdf', page: -5, zoom: Number.NaN })
    const saved = repo.get('c1', 'a.pdf')
    expect(saved?.page).toBe(1)
    expect(saved?.zoom).toBe(1)
  })
})
