import { describe, expect, test } from 'vitest'
import {
  fileNameFromRelPath,
  isContentSearchShortcut,
  materialKindForSearchHit,
  snippetSegments
} from '../../../src/renderer/src/features/search/searchUi'
import { jumpToPdfPageInPanel } from '../../../src/renderer/src/features/search/searchNavigation'

describe('content search UI helpers', () => {
  test('uses ⇧⌘F (or ⇧Ctrl+F) and rejects IME/extra modifiers', () => {
    const base = {
      key: 'f',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
      isComposing: false
    }
    expect(isContentSearchShortcut(base)).toBe(true)
    expect(
      isContentSearchShortcut({ ...base, metaKey: false, ctrlKey: true })
    ).toBe(true)
    expect(isContentSearchShortcut({ ...base, shiftKey: false })).toBe(false)
    expect(isContentSearchShortcut({ ...base, altKey: true })).toBe(false)
    expect(isContentSearchShortcut({ ...base, isComposing: true })).toBe(false)
  })

  test('highlights every NFC match even when the query arrives as NFD', () => {
    const segments = snippetSegments(
      '파동함수와 파동함수',
      '파동함수'.normalize('NFD')
    )

    expect(segments.filter((segment) => segment.matched)).toEqual([
      { text: '파동함수', matched: true },
      { text: '파동함수', matched: true }
    ])
  })

  test('keeps unmatched snippets intact and maps text hits to Finder behavior', () => {
    expect(snippetSegments('본문', '없는말')).toEqual([
      { text: '본문', matched: false }
    ])
    expect(materialKindForSearchHit('text')).toBe('other')
    expect(materialKindForSearchHit('note')).toBe('note')
    expect(fileNameFromRelPath('week/lecture.md')).toBe('lecture.md')
  })

  test('moves the PDF scroller with the existing page-relative jump formula', () => {
    const scroller = {
      scrollTop: 40,
      getBoundingClientRect: () => ({ top: 100 })
    }
    const page = {
      closest: (selector: string) =>
        selector === '.pdf-scroller' ? scroller : null,
      getBoundingClientRect: () => ({ top: 400 })
    }
    const panel = {
      querySelector: (selector: string) =>
        selector === '.pdf-page[data-pdf-page="7"]' ? page : null
    }

    expect(jumpToPdfPageInPanel(panel as unknown as HTMLElement, 7)).toBe(true)
    expect(scroller.scrollTop).toBe(328)
  })
})
