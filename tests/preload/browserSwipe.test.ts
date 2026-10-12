// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { waitForSwipe, type BrowserSwipeState } from '../../src/preload/browserSwipe'

let wheel: (event: WheelEvent) => void
let state: BrowserSwipeState
let windowListeners: Map<string, EventListener>
const scrollingElementDescriptor = Object.getOwnPropertyDescriptor(document, 'scrollingElement')

beforeEach(() => {
  vi.useFakeTimers()
  state = { canBack: true, canForward: true, enabled: true, theme: 'light' }
  windowListeners = new Map()
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'wheel') wheel = listener as (event: WheelEvent) => void
    windowListeners.set(type, listener as EventListener)
  })
  vi.spyOn(document, 'addEventListener')
})
afterEach(() => {
  document.documentElement.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove())
  if (scrollingElementDescriptor) Object.defineProperty(document, 'scrollingElement', scrollingElementDescriptor)
  else delete (document as unknown as { scrollingElement?: Element }).scrollingElement
  document.documentElement.removeAttribute('style')
  document.body.removeAttribute('style')
  for (const [type, listener] of vi.mocked(document.addEventListener).mock.calls) {
    if (type === 'visibilitychange') document.removeEventListener(type, listener)
  }
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

test('the document viewport keeps its default horizontal scrolling', async () => {
  const root = document.documentElement
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root })
  vi.spyOn(root, 'scrollWidth', 'get').mockReturnValue(900)
  vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(root, 'scrollLeft', 'get').mockReturnValue(100)
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  const event = swipe(-180, { composedPath: () => [document.body, root, document, window] })
  await vi.advanceTimersByTimeAsync(180)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(completed).not.toHaveBeenCalled()
})

test('a zero-delta opening packet does not pick the wrong scroll direction at an edge', async () => {
  const container = document.createElement('div')
  container.style.overflowX = 'auto'
  Object.defineProperties(container, { scrollWidth: { value: 600 }, clientWidth: { value: 200 }, scrollLeft: { value: 0 } })
  const completed = waitForSwipe(() => state)
  swipe(0, { composedPath: () => [container] })
  swipe(-180, { composedPath: () => [container] })
  await vi.advanceTimersByTimeAsync(180)
  await expect(completed).resolves.toBe('back')
})

test('body overflow hidden keeps the viewport from claiming a gesture it cannot scroll', async () => {
  const root = document.documentElement
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root })
  vi.spyOn(root, 'scrollWidth', 'get').mockReturnValue(900)
  vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(root, 'scrollLeft', 'get').mockReturnValue(100)
  document.body.style.overflowX = 'hidden'
  const completed = waitForSwipe(() => state)
  swipe(-180, { composedPath: () => [document.body, root, document, window] })
  await vi.advanceTimersByTimeAsync(180)
  await expect(completed).resolves.toBe('back')
})

test('body overscroll policy is not propagated with its overflow to the viewport', async () => {
  const root = document.documentElement
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root })
  document.body.style.overflowX = 'auto'
  document.body.style.overscrollBehaviorX = 'contain'
  const completed = waitForSwipe(() => state)
  swipe(-180, { composedPath: () => [document.body, root, document, window] })
  await vi.advanceTimersByTimeAsync(180)
  await expect(completed).resolves.toBe('back')
})

test('body containment keeps its own overscroll policy instead of propagating overflow', async () => {
  const root = document.documentElement
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root })
  document.body.style.overflowX = 'auto'
  document.body.style.overscrollBehaviorX = 'contain'
  document.body.style.contain = 'layout'
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-180, { composedPath: () => [document.body, root, document, window] })
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})

test('reversing toward scrollable content cancels the navigation gesture', async () => {
  const container = document.createElement('div')
  container.style.overflowX = 'auto'
  Object.defineProperties(container, { scrollWidth: { value: 600 }, clientWidth: { value: 200 }, scrollLeft: { value: 0 } })
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-40, { composedPath: () => [container] })
  const reversal = swipe(240, { composedPath: () => [container] })
  await vi.advanceTimersByTimeAsync(180)
  expect(reversal.preventDefault).not.toHaveBeenCalled()
  expect(completed).not.toHaveBeenCalled()
})

test('overscroll behavior on an ordinary element does not disable history gestures', async () => {
  const element = document.createElement('div')
  element.style.overscrollBehaviorX = 'contain'
  const completed = waitForSwipe(() => state)
  swipe(-180, { composedPath: () => [element] })
  await vi.advanceTimersByTimeAsync(180)
  await expect(completed).resolves.toBe('back')
})

test.each(['enabled', 'canBack'] as const)('navigation rechecks %s when the gesture finishes', async field => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-180)
  state[field] = false
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})

test('a first gesture can use the state refreshed while it was in progress', async () => {
  state.canBack = false
  const completed = waitForSwipe(() => state)
  swipe(-180)
  state.canBack = true
  await vi.advanceTimersByTimeAsync(180)
  await expect(completed).resolves.toBe('back')
})

test('leaving the page cancels a pending navigation and the next gesture still works', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-180)
  windowListeners.get('blur')?.(new Event('blur'))
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
  expect(document.documentElement.querySelector('[aria-hidden="true"]')).toBeNull()
  swipe(180)
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).toHaveBeenCalledWith('forward')
})

test('continuous input and its momentum produce only one navigation after becoming idle', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  for (let i = 0; i < 20; i++) {
    swipe(-20)
    await vi.advanceTimersByTimeAsync(100)
    expect(completed).not.toHaveBeenCalled()
  }
  await vi.advanceTimersByTimeAsync(80)
  expect(completed).toHaveBeenCalledExactlyOnceWith('back')
})

test.each(['auto', 'scroll', 'hidden'])('a %s scroll container can contain overscroll at its edge', async overflow => {
  const container = document.createElement('div')
  container.style.overflowX = overflow
  container.style.overscrollBehaviorX = 'contain'
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  const event = swipe(-180, { composedPath: () => [container] })
  await vi.advanceTimersByTimeAsync(180)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(completed).not.toHaveBeenCalled()
})

test.each([-180, 180])('nested RTL scrolling consumes delta %d before history navigation', async deltaX => {
  const child = document.createElement('div')
  const container = document.createElement('div')
  container.style.overflowX = 'auto'
  container.style.direction = 'rtl'
  Object.defineProperties(container, { scrollWidth: { value: 600 }, clientWidth: { value: 200 }, scrollLeft: { value: -200 } })
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  const event = swipe(deltaX, { composedPath: () => [child, container] })
  await vi.advanceTimersByTimeAsync(180)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(completed).not.toHaveBeenCalled()
})

test('scrolling retains the gesture after reaching an edge and releases it for the next stroke', async () => {
  const container = document.createElement('div')
  container.style.overflowX = 'auto'
  Object.defineProperties(container, { scrollWidth: { value: 600 }, clientWidth: { value: 200 }, scrollLeft: { value: 100, writable: true } })
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-120, { composedPath: () => [container] })
  container.scrollLeft = 0
  swipe(-180, { composedPath: () => [container] })
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
  swipe(-180, { composedPath: () => [container] })
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).toHaveBeenCalledExactlyOnceWith('back')
})

test('returning the gesture below the threshold cancels it', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-200)
  swipe(180)
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})

test('a page widget that consumes wheel input keeps ownership of the gesture', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-180, { defaultPrevented: true })
  swipe(-180)
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})

test('hiding the page cancels a pending gesture', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state).then(completed)
  swipe(-180)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
  expect(document.documentElement.querySelector('[aria-hidden="true"]')).toBeNull()
})

test('ancestor approval is required before preventing native scrolling and is rechecked at commit', async () => {
  const checkParents = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  const completed = vi.fn()
  void waitForSwipe(() => state, checkParents).then(completed)
  expect(swipe(-180).preventDefault).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(0)
  expect(swipe(-20).preventDefault).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(180)
  expect(checkParents).toHaveBeenCalledTimes(2)
  expect(checkParents.mock.calls[1]).toEqual(checkParents.mock.calls[0])
  expect(completed).not.toHaveBeenCalled()
})

test('unanswered ancestor policy fails closed without consuming the wheel', async () => {
  const completed = vi.fn()
  void waitForSwipe(() => state, () => new Promise(() => {})).then(completed)
  expect(swipe(-180).preventDefault).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})

test('a direction reversal discards stale ancestor permission', async () => {
  let oldReply!: (value: boolean) => void
  const checkParents = vi.fn().mockImplementationOnce(() => new Promise(resolve => { oldReply = resolve })).mockResolvedValue(false)
  const completed = vi.fn()
  void waitForSwipe(() => state, checkParents).then(completed)
  swipe(-20)
  swipe(220)
  await vi.advanceTimersByTimeAsync(0)
  oldReply(true)
  await vi.advanceTimersByTimeAsync(180)
  expect(checkParents.mock.calls.map(call => call[0])).toEqual(['back', 'forward'])
  expect(completed).not.toHaveBeenCalled()
})

test('a newer gesture invalidates a delayed final ancestor check', async () => {
  let finalReply!: (value: boolean) => void
  const checkParents = vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise(resolve => { finalReply = resolve })).mockResolvedValue(false)
  const completed = vi.fn()
  void waitForSwipe(() => state, checkParents).then(completed)
  swipe(-180)
  await vi.advanceTimersByTimeAsync(180)
  swipe(20)
  finalReply(true)
  await vi.advanceTimersByTimeAsync(180)
  expect(completed).not.toHaveBeenCalled()
})

test('blur invalidates a delayed final ancestor check', async () => {
  let finalReply!: (value: boolean) => void
  const checkParents = vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise(resolve => { finalReply = resolve }))
  const completed = vi.fn()
  void waitForSwipe(() => state, checkParents).then(completed)
  swipe(-180)
  await vi.advanceTimersByTimeAsync(180)
  windowListeners.get('blur')!(new Event('blur'))
  finalReply(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(completed).not.toHaveBeenCalled()
})
