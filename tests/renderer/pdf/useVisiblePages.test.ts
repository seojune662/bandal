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
})
