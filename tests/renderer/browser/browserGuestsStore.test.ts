/**
 * Node-environment store tests. No anchors are ever published here, so every
 * guest counts as hidden for LRU purposes — which is exactly the eviction
 * path we want to exercise.
 */

import { beforeEach, describe, expect, test } from 'vitest'
import {
  resetBrowserGuestsForTests,
  useBrowserGuests
} from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { MAX_LIVE_GUESTS } from '../../../src/renderer/src/features/browser/guestLru'

const store = () => useBrowserGuests.getState()

beforeEach(() => {
  resetBrowserGuestsForTests()
})

describe('ensureGuest', () => {
  test('creates a live guest with the initial URL and seeded nav state', () => {
    store().ensureGuest('t1', 'https://example.com')

    expect(store().liveGuests).toEqual([
      { tabId: 't1', src: 'https://example.com' }
    ])
    expect(store().nav['t1']).toMatchObject({
      url: 'https://example.com',
      loading: false,
      canGoBack: false
    })
  })

  test('is idempotent and bumps the guest to most-recently-used', () => {
    store().ensureGuest('t1', 'https://a.com')
    store().ensureGuest('t2', 'https://b.com')
    store().ensureGuest('t1', 'https://a.com')

    expect(store().liveGuests.map((g) => g.tabId)).toEqual(['t2', 't1'])
    expect(store().liveGuests).toHaveLength(2)
  })

  test('evicts the oldest hidden guest beyond the cap, never the newcomer', () => {
    for (let i = 0; i < MAX_LIVE_GUESTS; i += 1) {
      store().ensureGuest(`t${i}`, `https://site${i}.com`)
    }
    store().ensureGuest('fresh', 'https://fresh.com')

    const ids = store().liveGuests.map((g) => g.tabId)
    expect(ids).toHaveLength(MAX_LIVE_GUESTS)
    expect(ids).not.toContain('t0')
    expect(ids).toContain('fresh')
    expect(store().nav['t0']).toBeUndefined()
  })
})

describe('nav state + URL restore', () => {
  test('updateNav merges patches into the guest state', () => {
    store().ensureGuest('t1', 'https://a.com')
    store().updateNav('t1', { loading: true })
    store().updateNav('t1', { title: 'Example', canGoBack: true })

    expect(store().nav['t1']).toMatchObject({
      loading: true,
      title: 'Example',
      canGoBack: true,
      url: 'https://a.com'
    })
  })

  test('updateNav for a non-live guest is a no-op', () => {
    store().updateNav('ghost', { title: 'x' })
    expect(store().nav['ghost']).toBeUndefined()
  })

  test('a re-created guest restores its last committed URL', () => {
    store().ensureGuest('t1', 'https://start.com')
    store().updateNav('t1', { url: 'https://deep.com/page' })
    store().removeGuest('t1')
    expect(store().liveGuests).toEqual([])

    store().ensureGuest('t1', 'https://start.com')
    expect(store().liveGuests[0]?.src).toBe('https://deep.com/page')
    expect(store().nav['t1']?.url).toBe('https://deep.com/page')
  })
})

describe('removeGuest', () => {
  test('drops the guest and its nav state', () => {
    store().ensureGuest('t1', 'https://a.com')
    store().ensureGuest('t2', 'https://b.com')
    store().removeGuest('t1')

    expect(store().liveGuests.map((g) => g.tabId)).toEqual(['t2'])
    expect(store().nav['t1']).toBeUndefined()
    expect(store().nav['t2']).toBeDefined()
  })

  test('ignores unknown ids', () => {
    store().removeGuest('nope')
    expect(store().liveGuests).toEqual([])
  })
})
