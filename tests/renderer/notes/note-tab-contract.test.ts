import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import NoteTab, {
  isNoteConflict,
  PageNoteWorkspace
} from '../../../src/renderer/src/features/notes/NoteTab'

describe('NoteTab panel contract', () => {
  test('provides a default dockview component export', () => {
    expect(typeof NoteTab).toBe('function')
  })

  test.each([
    Object.assign(new Error('mtime changed'), { name: 'ConflictError' }),
    new Error("Error invoking remote method 'notes:write': [conflict] mtime changed"),
    { message: '[conflict] mtime changed' }
  ])('recognizes a wrapped notes conflict', (error) => {
    expect(isNoteConflict(error)).toBe(true)
  })

  test('does not classify an unrelated write failure as a conflict', () => {
    expect(isNoteConflict(new Error('disk full'))).toBe(false)
  })

  test('keeps the page-note toolbar inside a Milkdown provider', () => {
    const html = renderToStaticMarkup(
      createElement(PageNoteWorkspace, {
        courseId: 'course-1',
        relPath: 'lecture 페이지 필기.md',
        document: {
          manifest: {
            version: 1,
            source: 'lecture.pdf',
            fingerprint: 'pdf-v1',
            pages: [
              { width: 595, height: 842 },
              { width: 595, height: 842 }
            ]
          },
          title: '강의 필기',
          pages: ['', ''],
          appendix: ''
        },
        onMarkdownChange: () => undefined,
        fontScale: 1,
        onFontScaleChange: () => undefined,
        onZoomStep: () => undefined,
        pageNotePair: null,
        panelId: 'note-panel',
        syncEnabled: true,
        onCurrentPageChange: () => undefined
      })
    )

    expect(html).toContain('class="note-format-bar"')
    expect(html).toContain('aria-label="1 페이지 필기"')
    expect(html).toContain('aria-label="2 페이지 필기"')
    expect(html).not.toContain('필기를 시작하세요')
    expect(html).not.toContain('눌러서 이 페이지에 필기하세요')
  })
})
