import { describe, expect, test, vi } from 'vitest'
import {
  openMaterialLink,
  parseMaterialLinkHref,
  resolveNoteLink,
  type MaterialLinkNavigationDeps
} from '../../../src/renderer/src/features/notes/materialLinkNavigation'

describe('note material link navigation', () => {
  test('decodes Korean, spaces, #, and & from a generated material URL', () => {
    const href =
      'bandal://material?path=' +
      encodeURIComponent('1주차/자료 구조 #1 & 보충.pdf') +
      '&page=7&annotationId=' +
      encodeURIComponent('강조 #1 & 메모')

    expect(parseMaterialLinkHref(href)).toEqual({
      relPath: '1주차/자료 구조 #1 & 보충.pdf',
      page: 7,
      annotationId: '강조 #1 & 메모'
    })
  })

  test.each([
    'https://example.com/lecture.pdf',
    'http://localhost:5173/file',
    'mailto:student@example.com',
    '/relative-note.md'
  ])('leaves non-bandal hrefs unchanged: %s', (href) => {
    expect(resolveNoteLink(href)).toEqual({ kind: 'pass-through' })
  })

  test('intercepts malformed Bandal links without opening them externally', () => {
    expect(resolveNoteLink('bandal://material?page=2')).toEqual({
      kind: 'invalid-bandal'
    })
    expect(resolveNoteLink('bandal://future/route')).toEqual({
      kind: 'invalid-bandal'
    })
  })

  test('opens the PDF, jumps to its page, and requests annotation flash', () => {
    const deps: MaterialLinkNavigationDeps = {
      openMaterial: vi.fn(),
      jumpToPage: vi.fn(),
      jumpToAnnotation: vi.fn()
    }

    openMaterialLink(
      'course-1',
      { relPath: '자료/Chap 1.pdf', page: 5, annotationId: 'annotation-5' },
      deps
    )

    expect(deps.openMaterial).toHaveBeenCalledWith(
      'course-1',
      '자료/Chap 1.pdf'
    )
    expect(deps.jumpToPage).toHaveBeenCalledWith(5)
    expect(deps.jumpToAnnotation).toHaveBeenCalledWith({
      courseId: 'course-1',
      relPath: '자료/Chap 1.pdf',
      page: 5,
      annotationId: 'annotation-5'
    })
  })

  test('opens a whole-file link without invoking PDF jump helpers', () => {
    const deps: MaterialLinkNavigationDeps = {
      openMaterial: vi.fn(),
      jumpToPage: vi.fn(),
      jumpToAnnotation: vi.fn()
    }

    openMaterialLink('course-1', { relPath: '자료.pdf', page: null }, deps)

    expect(deps.openMaterial).toHaveBeenCalledWith('course-1', '자료.pdf')
    expect(deps.jumpToPage).not.toHaveBeenCalled()
    expect(deps.jumpToAnnotation).not.toHaveBeenCalled()
  })
})

