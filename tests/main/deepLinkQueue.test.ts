/**
 * The queue exists for exactly one scenario: macOS delivers `open-url` before
 * `whenReady()` resolves. If that URL is dropped, OAuth appears to work only on
 * the second attempt — the bug this file is here to prevent from regressing.
 */

import { describe, expect, test, vi } from 'vitest'
import {
  createDeepLinkQueue,
  DEEP_LINK_BUFFER_LIMIT
} from '../../src/main/deepLinkQueue'

const CALLBACK = 'bandal://auth/callback?code=abc123'

describe('createDeepLinkQueue', () => {
  test('replays a url pushed before the handler was attached', () => {
    const queue = createDeepLinkQueue()
    queue.push(CALLBACK)
    expect(queue.pending()).toEqual([CALLBACK])

    const handler = vi.fn()
    queue.attach(handler)

    expect(handler).toHaveBeenCalledExactlyOnceWith(CALLBACK)
    expect(queue.pending()).toEqual([])
  })

  test('replays in arrival order', () => {
    const queue = createDeepLinkQueue()
    queue.push('bandal://auth/callback?code=1')
    queue.push('bandal://auth/callback?code=2')

    const seen: string[] = []
    queue.attach((url) => seen.push(url))

    expect(seen).toEqual([
      'bandal://auth/callback?code=1',
      'bandal://auth/callback?code=2'
    ])
  })

  test('delivers straight through once attached', () => {
    const queue = createDeepLinkQueue()
    const handler = vi.fn()
    queue.attach(handler)

    queue.push(CALLBACK)

    expect(handler).toHaveBeenCalledExactlyOnceWith(CALLBACK)
    expect(queue.pending()).toEqual([])
  })

  test('a second attach does not re-deliver what was already replayed', () => {
    const queue = createDeepLinkQueue()
    queue.push(CALLBACK)
    const first = vi.fn()
    queue.attach(first)

    const second = vi.fn()
    queue.attach(second)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  test('drops the oldest url past the buffer limit', () => {
    const queue = createDeepLinkQueue()
    const urls = Array.from(
      { length: DEEP_LINK_BUFFER_LIMIT + 3 },
      (_, index) => `bandal://auth/callback?code=${index}`
    )
    for (const url of urls) queue.push(url)

    // The newest callback is the one the user is standing there waiting for.
    expect(queue.pending()).toEqual(urls.slice(-DEEP_LINK_BUFFER_LIMIT))
  })

  test('ignores empty pushes instead of buffering noise', () => {
    const queue = createDeepLinkQueue()
    queue.push('')
    expect(queue.pending()).toEqual([])
  })

  test('a throwing handler does not poison the queue', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queue = createDeepLinkQueue()
    const handler = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
      .mockImplementation(() => undefined)

    queue.attach(handler)
    expect(() => queue.push('bandal://auth/callback?code=1')).not.toThrow()
    queue.push('bandal://auth/callback?code=2')

    expect(handler).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })
})
