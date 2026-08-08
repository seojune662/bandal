import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  indexExtractedPdfPage,
  resetPdfPageIndexTrackerForTests
} from '../../../src/renderer/src/features/search/pdfPageIndex'

describe('PDF page search indexing', () => {
  beforeEach(() => {
    resetPdfPageIndexTrackerForTests()
  })

  test('fire-and-forgets a page and deduplicates it across remounts', () => {
    const invokeIndex = vi.fn(async () => ({ ok: true as const }))
    const target = { courseId: 'course-1', relPath: 'lecture.pdf' }

    indexExtractedPdfPage(target, 'fingerprint-a', 2, '페이지 본문', invokeIndex)
    indexExtractedPdfPage(target, 'fingerprint-a', 2, '페이지 본문', invokeIndex)
    indexExtractedPdfPage(target, 'fingerprint-a', 3, '다음 페이지', invokeIndex)

    expect(invokeIndex).toHaveBeenCalledTimes(2)
    expect(invokeIndex).toHaveBeenNthCalledWith(1, {
      ...target,
      pages: [{ page: 2, text: '페이지 본문' }]
    })
  })

  test('a changed PDF fingerprint is indexed again', () => {
    const invokeIndex = vi.fn(async () => ({ ok: true as const }))
    const target = { courseId: 'course-1', relPath: 'lecture.pdf' }

    indexExtractedPdfPage(target, 'fingerprint-old', 1, 'old', invokeIndex)
    indexExtractedPdfPage(target, 'fingerprint-new', 1, 'new', invokeIndex)

    expect(invokeIndex).toHaveBeenCalledTimes(2)
  })

  test('swallows failure and permits a later retry', async () => {
    const invokeIndex = vi
      .fn()
      .mockRejectedValueOnce(new Error('index unavailable'))
      .mockResolvedValueOnce({ ok: true as const })
    const target = { courseId: 'course-1', relPath: 'lecture.pdf' }

    expect(() =>
      indexExtractedPdfPage(target, 'fingerprint-a', 4, '본문', invokeIndex)
    ).not.toThrow()
    await Promise.resolve()
    indexExtractedPdfPage(target, 'fingerprint-a', 4, '본문', invokeIndex)

    expect(invokeIndex).toHaveBeenCalledTimes(2)
  })

  test('also swallows a synchronous transport failure', () => {
    const invokeIndex = vi.fn(() => {
      throw new Error('bridge unavailable')
    })

    expect(() =>
      indexExtractedPdfPage(
        { courseId: 'course-1', relPath: 'lecture.pdf' },
        'fingerprint-a',
        1,
        '본문',
        invokeIndex
      )
    ).not.toThrow()
  })
})
