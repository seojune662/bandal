// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { BandalMark, MARK_REST_MS } from '../../../src/renderer/src/components/BandalMark'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('periodic marks rest between rotations and stop for reduced motion or offscreen content', async () => {
  vi.useFakeTimers()
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0, now = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => media)
  let intersect!: IntersectionObserverCallback
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback }
    observe() {} disconnect() {}
  })
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element)
  const advanceFrames = (count: number) => {
    for (let i = 0; i < count; i++) {
      now += 100
      const callbacks = [...frames.values()]; frames.clear()
      callbacks.forEach(callback => callback(now))
    }
  }
  try {
    await act(() => root.render(<BandalMark size={56} />))
    const path = element.querySelector('path')!
    const resting = path.getAttribute('transform')
    advanceFrames(10)
    expect(path.getAttribute('transform')).not.toBe(resting)
    advanceFrames(12)
    expect(path.getAttribute('transform')).toBe(resting)
    expect(frames.size).toBe(0)
    vi.advanceTimersByTime(MARK_REST_MS - 1)
    expect(frames.size).toBe(0)
    vi.advanceTimersByTime(1)
    expect(frames.size).toBe(1)
    advanceFrames(10)
    expect(path.getAttribute('transform')).not.toBe(resting)
    media.matches = true
    media.addEventListener.mock.calls[0]![1]()
    expect(frames.size).toBe(0)
    expect(path.getAttribute('transform')).toBe(resting)
    expect(vi.getTimerCount()).toBe(0)
    media.matches = false
    media.addEventListener.mock.calls[0]![1]()
    expect(frames.size).toBe(1)
    intersect([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    expect(frames.size).toBe(1)
  } finally { await act(() => root.unmount()); element.remove() }
  expect(frames.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
