// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { waitForSwipe, type BrowserSwipeState } from '../../src/preload/browserSwipe'

let wheel: (event: WheelEvent) => void
let state: BrowserSwipeState

beforeEach(() => {
  vi.useFakeTimers()
  state = { canBack: true, canForward: true, enabled: true, theme: 'light' }
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'wheel') wheel = listener as (event: WheelEvent) => void
  })
})
afterEach(() => {
  document.documentElement.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove())
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function swipe(deltaX: number, extra: Partial<WheelEvent> = {}): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { isTrusted: true, deltaX, deltaY: 0, deltaMode: 0, composedPath: () => [], preventDefault: vi.fn(), ...extra }
  wheel(event as unknown as WheelEvent)
  return event
}

test.each(['light', 'dark'] as const)('navigation arrows use the app %s theme and navigate only once after a completed swipe', async theme => {
  state.theme = theme
  const completed = waitForSwipe(() => state)
  const event = swipe(-180)
  const hint = document.documentElement.querySelector<HTMLElement>('[aria-hidden="true"]')!
  expect(hint.style.backgroundColor).toBe(theme === 'dark' ? 'rgb(236, 236, 236)' : 'rgb(23, 23, 23)')
  expect(hint.style.color).toBe(theme === 'dark' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)')
  expect(hint.querySelector('svg')).not.toBeNull()
  expect(event.preventDefault).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(180)
  await expect(completed).resolves.toBe('back')
  expect(hint.isConnected).toBe(false)
})

test('the first gesture on a page never steals horizontal scrolling from a scroll container', async () => {
  const container = document.createElement('div')
  container.style.overflowX = 'auto'
  Object.defineProperties(container, { scrollWidth: { value: 600 }, clientWidth: { value: 200 }, scrollLeft: { value: 100 } })
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  const event = swipe(-180, { composedPath: () => [container] })
  await vi.advanceTimersByTimeAsync(180)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(completed).not.toHaveBeenCalled()
  expect(document.documentElement.querySelector('[aria-hidden="true"]')).toBeNull()
})

test('separate short gestures do not accumulate into an accidental navigation', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-90)
  await vi.advanceTimersByTimeAsync(190)
  swipe(-90)
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})

test('synthetic, vertical, modified, or unavailable gestures do not trigger navigation', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  for (const extra of [{ isTrusted: false }, { deltaY: 220 }, { ctrlKey: true }]) {
    expect(swipe(-180, extra).preventDefault).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(230)
  }
  state.canBack = false
  expect(swipe(-180).preventDefault).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})
