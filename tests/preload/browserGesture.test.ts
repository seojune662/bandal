// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BrowserSwipeState } from '../../src/preload/browserSwipe'

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), send: vi.fn(), waitForSwipe: vi.fn() }))
vi.mock('electron', () => ({ ipcRenderer: { invoke: bridge.invoke, send: bridge.send } }))
vi.mock('../../src/preload/browserSwipe', () => ({ BROWSER_SWIPE_IDLE_MS: 180, waitForSwipe: bridge.waitForSwipe }))
vi.mock('../../src/preload/browserSwipeParents', () => ({ createParentSwipePolicy: () => ({ checkParents: undefined }) }))

let listeners: Map<string, EventListener>
let finishGestures: Array<(action: 'back' | 'forward') => void>
const enabled: BrowserSwipeState = { canBack: true, canForward: true, enabled: true, theme: 'dark' }

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  bridge.invoke.mockReset().mockResolvedValue(enabled)
  bridge.send.mockClear()
  finishGestures = []
  bridge.waitForSwipe.mockReset().mockImplementation(() => new Promise(resolve => finishGestures.push(resolve)))
  listeners = new Map()
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
    listeners.set(type, listener as EventListener)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function start(): Promise<void> {
  await import('../../src/preload/browserGesture')
  listeners.get('DOMContentLoaded')!(new Event('DOMContentLoaded'))
  await Promise.resolve()
}

function state(): BrowserSwipeState {
  return bridge.waitForSwipe.mock.calls[0]![0]()
}

test.each(['resolve', 'reject'] as const)('an older state request cannot %s over a more recent response', async outcome => {
  let resolveOld!: (value: BrowserSwipeState) => void
  let rejectOld!: (reason: Error) => void
  bridge.invoke.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject }))
  await start()
  await vi.advanceTimersByTimeAsync(201)
  listeners.get('wheel')!({ isTrusted: true } as unknown as Event)
  await Promise.resolve()
  expect(state()).toEqual(enabled)
  if (outcome === 'resolve') resolveOld({ ...enabled, enabled: false, canBack: false })
  else rejectOld(new Error('old frame state'))
  await Promise.resolve()
  await Promise.resolve()
  expect(state()).toEqual(enabled)
})

test('a current refresh failure disables navigation', async () => {
  await start()
  bridge.invoke.mockRejectedValueOnce(new Error('frame gone'))
  await vi.advanceTimersByTimeAsync(201)
  listeners.get('wheel')!({ isTrusted: true } as unknown as Event)
  await Promise.resolve()
  await Promise.resolve()
  expect(state().enabled).toBe(false)
})

test('the first wheel after a history change refreshes even immediately after page initialization', async () => {
  bridge.invoke.mockResolvedValueOnce({ ...enabled, canBack: false })
  await start()
  expect(state().canBack).toBe(false)
  listeners.get('wheel')!({ isTrusted: true } as unknown as Event)
  await Promise.resolve()
  expect(bridge.invoke).toHaveBeenCalledTimes(2)
  expect(state().canBack).toBe(true)
})

test('state polling is throttled during a gesture but refreshed for the next separate gesture', async () => {
  await start()
  const wheel = (): void => listeners.get('wheel')!({ isTrusted: true } as unknown as Event)
  wheel()
  expect(bridge.invoke).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(100)
  wheel()
  expect(bridge.invoke).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(100)
  wheel()
  expect(bridge.invoke).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(180)
  wheel()
  expect(bridge.invoke).toHaveBeenCalledTimes(4)
})

test('the next gesture is registered immediately after completed back and forward gestures', async () => {
  await start()
  expect(bridge.waitForSwipe).toHaveBeenCalledTimes(1)
  finishGestures[0]!('back')
  await Promise.resolve()
  expect(bridge.send).toHaveBeenLastCalledWith('browser-gesture:navigate', 'back')
  expect(bridge.waitForSwipe).toHaveBeenCalledTimes(2)
  finishGestures[1]!('forward')
  await Promise.resolve()
  expect(bridge.send).toHaveBeenLastCalledWith('browser-gesture:navigate', 'forward')
  expect(bridge.waitForSwipe).toHaveBeenCalledTimes(3)
})
