/**
 * Node-environment store tests. No anchors are ever published here, so every
 * guest counts as hidden for LRU purposes — which is exactly the eviction
 * path we want to exercise.
 */

import { beforeEach, describe, expect, test } from 'vitest'
import {
  MAX_RECENT_VISITS,
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

describe('app-rendered start page', () => {
  test('starts without creating a webview guest', () => {
    store().ensureStartPage('new-tab')

    expect(store().liveGuests).toEqual([])
    expect(store().nav['new-tab']?.url).toBe('')
    expect(store().startPageVisible['new-tab']).toBe(true)
  })

  test('keeps a guest alive while the start page replaces it', () => {
    store().ensureStartPage('new-tab')
    store().ensureGuest('new-tab', 'https://example.invalid')
    store().setStartPageVisible('new-tab', false)
    store().setStartPageVisible('new-tab', true)

    expect(store().liveGuests).toEqual([
      { tabId: 'new-tab', src: 'https://example.invalid' }
    ])
    expect(store().startPageVisible['new-tab']).toBe(true)
  })

  test('cleans up a start-only tab that never created a guest', () => {
    store().ensureStartPage('new-tab')
    store().removeGuest('new-tab')

    expect(store().nav['new-tab']).toBeUndefined()
    expect(store().recent['new-tab']).toBeUndefined()
    expect(store().startPageVisible['new-tab']).toBeUndefined()
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

  test('keeps recent visits in tab memory, deduplicated and bounded', () => {
    store().ensureGuest('t1', 'https://start.example')
    for (let index = 0; index < MAX_RECENT_VISITS + 2; index += 1) {
      store().updateNav('t1', { url: `https://site${index}.example/page` })
    }
    store().updateNav('t1', { title: 'Latest page' })
    store().updateNav('t1', { url: 'https://site2.example/page' })

    const visits = store().recent['t1'] ?? []
    expect(visits).toHaveLength(MAX_RECENT_VISITS)
    expect(visits[0]).toEqual({
      url: 'https://site2.example/page',
      title: 'site2.example'
    })
    expect(visits.filter((visit) => visit.url.includes('site2.'))).toHaveLength(1)
  })

  test('updates a visit title and ignores non-network documents', () => {
    store().ensureGuest('t1', 'https://example.com')
    store().updateNav('t1', { url: 'https://example.com/course' })
    store().updateNav('t1', { title: 'Course home' })
    store().updateNav('t1', { url: 'data:text/html,local' })

    expect(store().recent['t1']).toEqual([
      { url: 'https://example.com/course', title: 'Course home' }
    ])
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
