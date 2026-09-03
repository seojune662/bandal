import { describe, expect, test, vi } from 'vitest'
import {
  PageCenterCache,
  type PageBoxElement,
  type PageViewport
} from '../../../src/renderer/src/features/pdf/useVisiblePages'

describe('PageCenterCache', () => {
  test('measures all pages once, then uses cached centers while scrolling', () => {
    let pageSpacing = 100
    const pageReads = vi.fn()
    const scrollerReads = vi.fn(() => ({ top: 50 }))
    const scroller = {
      scrollTop: 0,
      clientHeight: 100,
      getBoundingClientRect: scrollerReads
    } satisfies PageViewport
    const elements = new Map<number, PageBoxElement>()
    for (let page = 1; page <= 300; page += 1) {
      elements.set(page, {
        getBoundingClientRect: () => {
          pageReads(page)
          return {
            top: 50 + (page - 1) * pageSpacing - scroller.scrollTop,
            height: pageSpacing * 0.8
          }
        }
      })
    }
    const cache = new PageCenterCache()

    expect(cache.pageAtViewportCenter(scroller, elements)).toBe(1)
    scroller.scrollTop = 24_890
    expect(cache.pageAtViewportCenter(scroller, elements)).toBe(250)
    scroller.scrollTop = 190
    expect(cache.pageAtViewportCenter(scroller, elements)).toBe(3)
    scroller.scrollTop = 24_840
    scroller.clientHeight = 200
    expect(cache.pageAtViewportCenter(scroller, elements)).toBe(250)

    expect(pageReads).toHaveBeenCalledTimes(300)
    expect(scrollerReads).toHaveBeenCalledTimes(1)

    pageSpacing = 200
    scroller.clientHeight = 100
    scroller.scrollTop = 49_830
    cache.invalidate()
    expect(cache.pageAtViewportCenter(scroller, elements)).toBe(250)
    expect(pageReads).toHaveBeenCalledTimes(600)
    expect(scrollerReads).toHaveBeenCalledTimes(2)
  })

  test('includes pages registered after the initial document layout', () => {
    const scroller = {
      scrollTop: 180,
      clientHeight: 100,
      getBoundingClientRect: () => ({ top: 0 })
    } satisfies PageViewport
    const elements = new Map<number, PageBoxElement>([
      [1, { getBoundingClientRect: () => ({ top: -180, height: 80 }) }],
      [2, { getBoundingClientRect: () => ({ top: -80, height: 80 }) }]
    ])
    const cache = new PageCenterCache()
    expect(cache.pageAtViewportCenter(scroller, elements)).toBe(2)

    elements.set(3, {
      getBoundingClientRect: () => ({ top: 20, height: 80 })
    })
    cache.invalidate()
    expect(cache.pageAtViewportCenter(scroller, elements)).toBe(3)
  })

  test('restores the same position inside a page after every page reflows', () => {
    let scale = 1
    const scroller = {
      scrollTop: 1_020,
      clientHeight: 200,
      getBoundingClientRect: () => ({ top: 40 })
    } satisfies PageViewport
    const pageBox = (page: number): PageBoxElement => ({
      getBoundingClientRect: () => ({
        top: 40 + 20 + (page - 1) * (800 * scale + 20) - scroller.scrollTop,
        height: 800 * scale
      })
    })
    const elements = new Map<number, PageBoxElement>([
      [1, pageBox(1)],
      [2, pageBox(2)],
      [3, pageBox(3)]
    ])
    const cache = new PageCenterCache()

    const anchor = cache.captureViewportAnchor(scroller, elements)
    expect(anchor).toEqual({ page: 2, pageOffset: 0.35 })

    // A sidebar closes: fit-width pages grow by 50%, but the browser keeps
    // the old numeric scrollTop until we restore the semantic anchor.
    scale = 1.5
    cache.invalidate()
    expect(cache.restoreViewportAnchor(scroller, elements, anchor!)).toBe(true)
    expect(scroller.scrollTop).toBe(1_560)

    cache.invalidate()
    expect(cache.captureViewportAnchor(scroller, elements)).toEqual({
      page: 2,
      pageOffset: 0.35
    })
  })

  test('does not capture or overwrite position while a panel is hidden', () => {
    const scroller = {
      scrollTop: 900,
      clientHeight: 0,
      getBoundingClientRect: () => ({ top: 0 })
    } satisfies PageViewport
    const elements = new Map<number, PageBoxElement>([
      [2, { getBoundingClientRect: () => ({ top: 0, height: 0 }) }]
    ])
    const cache = new PageCenterCache()

    expect(cache.captureViewportAnchor(scroller, elements)).toBeNull()
    expect(
      cache.restoreViewportAnchor(scroller, elements, {
        page: 2,
        pageOffset: 0.5
      })
    ).toBe(false)
    expect(scroller.scrollTop).toBe(900)
  })
})
