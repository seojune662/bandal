import { afterEach, describe, expect, test, vi } from 'vitest'
import { createQuitDrain } from '../../src/main/lib/quitDrain'

afterEach(() => vi.useRealTimers())

describe('quit IPC drain', () => {
  test('a cookie-flush continuation cannot bypass the pending drain or schedule another quit', () => {
    vi.useFakeTimers()
    const resume = vi.fn(), drain = createQuitDrain(resume, 150)
    const event = { preventDefault: vi.fn() }
    drain.beforeQuit(event)
    vi.advanceTimersByTime(20)
    drain.beforeQuit(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(129)
    expect(resume).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(resume).toHaveBeenCalledOnce()
    drain.beforeQuit(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    vi.runAllTimers()
    expect(resume).toHaveBeenCalledOnce()
  })

  test('cancelling quit invalidates the pending timer without a later quit request', () => {
    vi.useFakeTimers()
    const resume = vi.fn(), drain = createQuitDrain(resume, 150)
    drain.beforeQuit({ preventDefault: vi.fn() })
    vi.advanceTimersByTime(50)
    drain.reset()
    vi.runAllTimers()
    expect(resume).not.toHaveBeenCalled()
  })

  test('a fresh quit after cancellation drains new IPC even if the earlier drain finished', () => {
    vi.useFakeTimers()
    const resume = vi.fn(), drain = createQuitDrain(resume, 150)
    const event = { preventDefault: vi.fn() }
    drain.beforeQuit(event)
    vi.advanceTimersByTime(150)
    drain.reset()
    drain.beforeQuit(event)
    vi.advanceTimersByTime(149)
    expect(resume).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(resume).toHaveBeenCalledTimes(2)
  })
})
