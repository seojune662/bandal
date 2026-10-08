import { describe, expect, test } from 'vitest'
import { PdfViewportResize } from '../../../src/renderer/src/features/pdf/lib/viewportResize'

describe('PDF viewport resize ownership', () => {
  test('keeps the pre-reflow anchor through scrollbar height changes and delayed page commits', () => {
    const resize = new PdfViewportResize()
    const anchor = { page: 6, pageOffset: 287 / 545 }
    resize.begin(anchor, { width: 720, height: 598, pageWidth: 672 })
    // A shrinking pane temporarily gains a 14px horizontal scrollbar. Its
    // scroll event and subsequent React commit are not a new reading position.
    resize.begin({ page: 6, pageOffset: 280 / 545 }, { width: 434, height: 584, pageWidth: 386 })
    expect(resize.anchor).toEqual(anchor)
    for (let frame = 0; frame < 5; frame++) {
      expect(resize.observe({ width: 434, height: 584, pageWidth: 672 })).toBe(false)
    }
    expect(resize.anchor).toEqual(anchor)
    resize.begin({ page: 6, pageOffset: 273 / 545 }, { width: 434, height: 598, pageWidth: 386 })
    const committed = { width: 434, height: 598, pageWidth: 386 }
    expect(resize.observe(committed)).toBe(false)
    expect(resize.observe(committed)).toBe(false)
    expect(resize.anchor).toEqual(anchor)
    expect(resize.observe(committed)).toBe(true)
    expect(resize.anchor).toBeNull()
  })

  test('ignores its final rounded scroll echo after settling, but lets user input take over', () => {
    const resize = new PdfViewportResize()
    const geometry = { width: 434, height: 598, pageWidth: 386 }
    resize.begin({ page: 6, pageOffset: 287 / 545 }, geometry)
    resize.recordRestoredScroll(2842)
    for (let frame = 0; frame < 3; frame++) resize.observe(geometry)
    expect(resize.isScrollEcho(2842)).toBe(true)
    expect(resize.isScrollEcho(2900)).toBe(false)
    resize.begin({ page: 6, pageOffset: 0.5 }, geometry)
    resize.cancel()
    expect(resize.anchor).toBeNull()
    expect(resize.isScrollEcho(2842)).toBe(false)
    const next = { page: 7, pageOffset: 0.2 }
    resize.begin(next, geometry)
    expect(resize.anchor).toEqual(next)
  })
})
