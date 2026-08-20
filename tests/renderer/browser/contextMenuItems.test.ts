/**
 * Which right-click entries a guest page offers.
 *
 * This is unit-tested rather than exercised end-to-end because Playwright
 * drives the HOST renderer: a synthetic click on the `<webview>` element never
 * reaches the guest WebContents, so no `context-menu` event fires. The pure
 * derivation is where all the branching lives.
 */
import { describe, expect, test } from 'vitest'
import { contextMenuItems } from '../../../src/renderer/src/features/browser/BrowserContextMenu'

const EMPTY = {
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  selectionText: '',
  courseId: 'course-1'
}

describe('contextMenuItems', () => {
  test('a bare page still offers something useful', () => {
    // Right-clicking blank space used to do literally nothing.
    expect(contextMenuItems(EMPTY)).toEqual([
      'reload',
      'copy-page-url',
      'print',
      'open-external',
      'diagnose',
      'inspect'
    ])
  })

  test('a link adds open / copy / save', () => {
    const items = contextMenuItems({
      ...EMPTY,
      linkURL: 'https://myetl.snu.ac.kr/files/1.pdf'
    })
    expect(items.slice(0, 3)).toEqual(['open-link', 'copy-link', 'save-link'])
  })

  test('an image adds copy / save', () => {
    const items = contextMenuItems({
      ...EMPTY,
      mediaType: 'image',
      srcURL: 'https://example.com/a.png'
    })
    expect(items).toContain('copy-image')
    expect(items).toContain('save-image')
  })

  test('a media type without a source offers no image actions', () => {
    const items = contextMenuItems({ ...EMPTY, mediaType: 'image', srcURL: '' })
    expect(items).not.toContain('save-image')
  })

  test('video and canvas are not treated as saveable images', () => {
    for (const mediaType of ['video', 'audio', 'canvas', 'plugin']) {
      const items = contextMenuItems({
        ...EMPTY,
        mediaType,
        srcURL: 'https://example.com/a.bin'
      })
      expect(items, mediaType).not.toContain('save-image')
    }
  })

  test('a selection adds copy / search / clip', () => {
    const items = contextMenuItems({ ...EMPTY, selectionText: '해시 충돌' })
    expect(items).toContain('copy-selection')
    expect(items).toContain('search-selection')
    expect(items).toContain('clip-to-note')
  })

  test('without a course there is nowhere to clip to', () => {
    const items = contextMenuItems({
      ...EMPTY,
      selectionText: '해시 충돌',
      courseId: null
    })
    expect(items).toContain('copy-selection')
    expect(items).not.toContain('clip-to-note')
  })

  test('a whitespace-only selection is not a selection', () => {
    // Chromium reports the surrounding whitespace on a stray double-click.
    const items = contextMenuItems({ ...EMPTY, selectionText: '   \n  ' })
    expect(items).not.toContain('copy-selection')
  })

  test('an image link offers both families, links first', () => {
    const items = contextMenuItems({
      linkURL: 'https://example.com/big.png',
      srcURL: 'https://example.com/thumb.png',
      mediaType: 'image',
      selectionText: ''
    })
    expect(items.indexOf('open-link')).toBeLessThan(items.indexOf('copy-image'))
    expect(items).toEqual([
      'open-link',
      'copy-link',
      'save-link',
      'copy-image',
      'save-image',
      'reload',
      'copy-page-url',
      'print',
      'open-external',
      'diagnose',
      'inspect'
    ])
  })

  test('never produces a duplicate entry', () => {
    const items = contextMenuItems({
      linkURL: 'https://a',
      srcURL: 'https://b',
      mediaType: 'image',
      selectionText: 'x'
    })
    expect(new Set(items).size).toBe(items.length)
  })
})

describe('contextMenuItems — editable fields', () => {
  const editable = (over: Record<string, unknown> = {}) =>
    contextMenuItems({
      linkURL: '',
      srcURL: '',
      mediaType: 'none',
      selectionText: '',
      isEditable: true,
      courseId: 'ds',
      ...over
    } as Parameters<typeof contextMenuItems>[0])

  test('a text field offers 붙여넣기 and 전체 선택', () => {
    // Korean students paste 학번 into portal fields constantly, and this menu
    // used to offer them 새로고침 · 페이지 주소 복사 · 검사 — nothing usable.
    const items = editable()
    expect(items).toContain('paste')
    expect(items).toContain('select-all')
  })

  test('with a selection it also offers 잘라내기 and 복사', () => {
    const items = editable({ selectionText: '2021123456' })
    expect(items).toContain('cut-selection')
    expect(items).toContain('copy-selection')
    expect(items.indexOf('cut-selection')).toBeLessThan(items.indexOf('paste'))
  })

  test('no selection means nothing to cut', () => {
    expect(editable()).not.toContain('cut-selection')
  })

  test('a link inside a contenteditable keeps BOTH families, as Chrome does', () => {
    const items = editable({ linkURL: 'https://x/' })
    expect(items).toContain('open-link')
    expect(items).toContain('paste')
  })

  test('a non-editable page never offers 붙여넣기', () => {
    expect(
      contextMenuItems({
        linkURL: '',
        srcURL: '',
        mediaType: 'none',
        selectionText: '',
        isEditable: false,
        courseId: 'ds'
      } as Parameters<typeof contextMenuItems>[0])
    ).not.toContain('paste')
  })
})
