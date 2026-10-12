// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createParentSwipePolicy } from '../../src/preload/browserSwipeParents'

const channel = 'bandal-browser-swipe-policy-v1'
const id = 'a'.repeat(32)
let windowListeners: Map<string, EventListener>
let documentListeners: Map<string, EventListener>
let dispose: (() => void) | undefined
let post: ReturnType<typeof vi.spyOn>
const scrollingElementDescriptor = Object.getOwnPropertyDescriptor(document, 'scrollingElement')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  windowListeners = new Map()
  documentListeners = new Map()
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => { windowListeners.set(type, listener as EventListener) })
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener) => { documentListeners.set(type, listener as EventListener) })
  post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  if (scrollingElementDescriptor) Object.defineProperty(document, 'scrollingElement', scrollingElementDescriptor)
  else delete (document as unknown as { scrollingElement?: Element }).scrollingElement
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup(parent?: Window) {
  if (parent) vi.spyOn(window, 'parent', 'get').mockReturnValue(parent)
  const policy = createParentSwipePolicy()
  dispose = policy.dispose
  return policy
}

function receive(data: unknown, source: Window, isTrusted = true) {
  const event = { data, source, isTrusted, stopImmediatePropagation: vi.fn() }
  windowListeners.get('message')!(event as unknown as Event)
  return event
}

function child(scroller?: Element | ShadowRoot) {
  const frame = document.createElement('iframe')
  ;(scroller ?? document.body).append(frame)
  vi.spyOn(frame, 'getClientRects').mockReturnValue([{ width: 100, height: 100 }] as unknown as DOMRectList)
  return frame
}

function request(source: Window, startedAt = Date.now(), direction = 'back') {
  return receive({ channel, kind: 'request', id, direction, startedAt }, source)
}

test('top-level gestures need no async gate and policy messages never install a wheel listener', async () => {
  const policy = setup()
  expect(policy.checkParents).toBeUndefined()
  const frame = child()
  expect(request(frame.contentWindow!).stopImmediatePropagation).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: true }, { targetOrigin: '*' })
  expect(windowListeners.has('wheel')).toBe(false)
})

test('ancestor scrolling and overscroll containment deny child navigation', async () => {
  setup()
  const container = document.createElement('div')
  document.body.append(container)
  container.style.overflowX = 'auto'
  Object.defineProperties(container, { scrollWidth: { value: 600 }, clientWidth: { value: 200 }, scrollLeft: { value: 10, writable: true } })
  const frame = child(container)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
  container.scrollLeft = 0
  container.style.overscrollBehaviorX = 'contain'
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
})

test('the first default packet reaching an ancestor edge still blocks the entire gesture', async () => {
  setup()
  const container = document.createElement('div')
  document.body.append(container)
  container.style.overflowX = 'auto'
  Object.defineProperties(container, { scrollWidth: { value: 600 }, clientWidth: { value: 200 }, scrollLeft: { value: 0 } })
  const frame = child(container)
  const startedAt = Date.now()
  documentListeners.get('scroll')!({ target: container, isTrusted: true } as unknown as Event)
  request(frame.contentWindow!, startedAt)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
  await vi.advanceTimersByTimeAsync(180)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: true }, { targetOrigin: '*' })
})

test('document scroll events are tracked on the viewport', async () => {
  setup()
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
  const frame = child()
  documentListeners.get('scroll')!({ target: document, isTrusted: true } as unknown as Event)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
})

test('unrelated child scrolling does not block the source iframe', async () => {
  setup()
  const frame = child()
  const unrelated = document.createElement('div')
  document.body.append(unrelated)
  documentListeners.get('scroll')!({ target: unrelated, isTrusted: true } as unknown as Event)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: true }, { targetOrigin: '*' })
})

test('requests must come from an actual child window and have a valid shape', async () => {
  setup()
  const frame = child()
  expect(request(window).stopImmediatePropagation).not.toHaveBeenCalled()
  receive({ channel, kind: 'request', id, direction: 'up', startedAt: 1000 }, frame.contentWindow!)
  receive({ channel, kind: 'request', id, direction: 'back', startedAt: Infinity }, frame.contentWindow!)
  receive({ channel, kind: 'request', id, direction: 'back', startedAt: 1000 }, frame.contentWindow!, false)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).not.toHaveBeenCalled()
})

test('replies require the exact parent, unpredictable request ID and a boolean', async () => {
  const parent = {} as Window
  const policy = setup(parent)
  const completed = vi.fn()
  void policy.checkParents!('back', Date.now()).then(completed)
  const outgoing = post.mock.calls[0]![0] as { id: string }
  expect(outgoing.id).toMatch(/^[a-f0-9]{32}$/)
  receive({ channel, kind: 'reply', id: outgoing.id, allowed: true }, window)
  receive({ channel, kind: 'reply', id, allowed: true }, parent)
  receive({ channel, kind: 'reply', id: outgoing.id, allowed: 'yes' }, parent)
  receive({ channel, kind: 'reply', id: outgoing.id, allowed: true }, parent, false)
  await vi.advanceTimersByTimeAsync(0)
  expect(completed).not.toHaveBeenCalled()
  expect(receive({ channel, kind: 'reply', id: outgoing.id, allowed: true }, parent).stopImmediatePropagation).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(0)
  expect(completed).toHaveBeenCalledExactlyOnceWith(true)
})

test('nested parents are checked and scrolling while awaiting a reply still denies the gesture', async () => {
  const parent = {} as Window
  setup(parent)
  const frame = child()
  request(frame.contentWindow!)
  const outgoing = post.mock.calls[0]![0] as { id: string; startedAt: number }
  expect(outgoing.startedAt).toBe(1000)
  documentListeners.get('scroll')!({ target: document.body, isTrusted: true } as unknown as Event)
  receive({ channel, kind: 'reply', id: outgoing.id, allowed: true }, parent)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
})

test('timeout and page exit fail closed and stale replies cannot revive old requests', async () => {
  const parent = {} as Window
  const policy = setup(parent)
  const timedOut = policy.checkParents!('back', Date.now())
  const outgoing = post.mock.calls[0]![0] as { id: string }
  await vi.advanceTimersByTimeAsync(120)
  await expect(timedOut).resolves.toBe(false)
  expect(receive({ channel, kind: 'reply', id: outgoing.id, allowed: true }, parent).stopImmediatePropagation).not.toHaveBeenCalled()
  const suspended = policy.checkParents!('forward', Date.now())
  windowListeners.get('pagehide')!(new Event('pagehide'))
  await expect(suspended).resolves.toBe(false)
  await expect(policy.checkParents!('back', Date.now())).resolves.toBe(false)
  windowListeners.get('pageshow')!(new Event('pageshow'))
  const fresh = policy.checkParents!('back', Date.now())
  const latest = post.mock.calls.at(-1)![0] as { id: string }
  receive({ channel, kind: 'reply', id: latest.id, allowed: true }, parent)
  await expect(fresh).resolves.toBe(true)
})

test('pending parent queries are bounded', async () => {
  const policy = setup({} as Window)
  for (let index = 0; index < 32; index++) void policy.checkParents!('back', Date.now())
  await expect(policy.checkParents!('back', Date.now())).resolves.toBe(false)
  expect(post).toHaveBeenCalledTimes(32)
})

test('a hidden iframe cannot commit a pending history gesture', async () => {
  const parent = {} as Window
  setup(parent)
  const frame = child()
  request(frame.contentWindow!)
  const outgoing = post.mock.calls[0]![0] as { id: string }
  frame.style.visibility = 'hidden'
  receive({ channel, kind: 'reply', id: outgoing.id, allowed: true }, parent)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
})

test('synthetic scroll notifications do not claim a real gesture', async () => {
  setup()
  const frame = child()
  documentListeners.get('scroll')!({ target: document.body, isTrusted: false } as unknown as Event)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: true }, { targetOrigin: '*' })
})

test('new shadow ancestors fail closed, then record their non-composed scrolling', async () => {
  setup()
  const host = document.createElement('div')
  document.body.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const shadowListen = vi.spyOn(shadow, 'addEventListener')
  const container = document.createElement('div')
  shadow.append(container)
  const frame = child(container)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
  await vi.advanceTimersByTimeAsync(180)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: true }, { targetOrigin: '*' })
  const recordScroll = shadowListen.mock.calls.find(call => call[0] === 'scroll')![1] as EventListener
  recordScroll({ target: container, isTrusted: true } as unknown as Event)
  request(frame.contentWindow!)
  await vi.advanceTimersByTimeAsync(0)
  expect(post).toHaveBeenLastCalledWith({ channel, kind: 'reply', id, allowed: false }, { targetOrigin: '*' })
})
