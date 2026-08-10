import { describe, expect, test, vi } from 'vitest'
import { applyVerticalWheelToTabStrip } from '../../../src/renderer/src/features/workspace/tabStripScroll'

function scroller(scrollLeft = 0) {
  return { clientWidth: 200, scrollLeft, scrollWidth: 600 }
}

function wheel(deltaX: number, deltaY: number, deltaMode = 0) {
  return { deltaMode, deltaX, deltaY, preventDefault: vi.fn() }
}

describe('tab strip wheel scrolling', () => {
  test('converts pure vertical pixel-wheel input to horizontal movement', () => {
    const tabs = scroller(40)
    const event = wheel(0, 32)

    expect(applyVerticalWheelToTabStrip(tabs, event)).toBe(true)
    expect(tabs.scrollLeft).toBe(72)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  test('leaves horizontal and mixed trackpad gestures to native scrolling', () => {
    const tabs = scroller(40)
    const horizontal = wheel(32, 0)
    const mixed = wheel(32, 4)

    expect(applyVerticalWheelToTabStrip(tabs, horizontal)).toBe(false)
    expect(applyVerticalWheelToTabStrip(tabs, mixed)).toBe(false)
    expect(tabs.scrollLeft).toBe(40)
    expect(horizontal.preventDefault).not.toHaveBeenCalled()
    expect(mixed.preventDefault).not.toHaveBeenCalled()
  })

  test('clamps continuous input at the ends without leaking the wheel', () => {
    const tabs = scroller(390)
    const event = wheel(0, 32)

    expect(applyVerticalWheelToTabStrip(tabs, event)).toBe(true)
    expect(tabs.scrollLeft).toBe(400)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  test('does not consume wheel input when the tab strip fits', () => {
    const tabs = { clientWidth: 600, scrollLeft: 0, scrollWidth: 600 }
    const event = wheel(0, 32)

    expect(applyVerticalWheelToTabStrip(tabs, event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
