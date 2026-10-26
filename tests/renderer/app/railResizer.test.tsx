// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { RailResizer } from '../../../src/renderer/src/app/RailResizer'

test('left resize measures the complete rail including its outer border', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const width = (): number => Number.parseFloat(document.documentElement.style.getPropertyValue('--rail-left-width')) || 240
  const rectangle = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains('app-rail--left') ? width() - 1 : width() } as DOMRect
  })
  try {
    act(() => root.render(<><div className="shell-course-rail"><div className="shell-home-sidebar"><aside className="app-rail--left" /></div></div><RailResizer side="left" /></>))
    const separator = container.querySelector('[role="separator"]')!
    expect(separator.getAttribute('aria-valuenow')).toBe('240')
    for (const key of ['Home', 'ArrowRight', 'ArrowRight']) {
      act(() => separator.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
    }
    expect(width()).toBe(208)
    expect(separator.getAttribute('aria-valuenow')).toBe('208')
    expect(JSON.parse(localStorage.getItem('bandal:rail-widths:v1')!)).toEqual({ left: 208 })
  } finally {
    act(() => root.unmount())
    container.remove()
    rectangle.mockRestore()
    document.documentElement.style.removeProperty('--rail-left-width')
    localStorage.clear()
  }
})
