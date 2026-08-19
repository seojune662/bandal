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
  selectionText: ''
}

describe('contextMenuItems', () => {
  test('a bare page still offers something useful', () => {
    // Right-clicking blank space used to do literally nothing.
    expect(contextMenuItems(EMPTY)).toEqual([
      'reload',
      'copy-page-url',
      'open-external'
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

  test('a selection adds copy / search', () => {
    const items = contextMenuItems({ ...EMPTY, selectionText: '해시 충돌' })
    expect(items).toContain('copy-selection')
    expect(items).toContain('search-selection')
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
      'open-external'
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
