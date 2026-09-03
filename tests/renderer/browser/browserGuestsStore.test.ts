/**
 * Node-environment store tests. No anchors are ever published here, so every
 * guest counts as hidden for LRU purposes — which is exactly the eviction
 * path we want to exercise.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

// The store reports visits to main so the omnibox can rank them; there is no
// `window` here, and history is not what these tests are about.
vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(async () => ({ ok: true })),
  onPush: vi.fn(() => () => {})
}))

import {
  initialNavState,
  MAX_RECENT_VISITS,
  resetBrowserGuestsForTests,
  useBrowserGuests
} from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { MAX_LIVE_GUESTS } from '../../../src/renderer/src/features/browser/guestLru'
import { invoke } from '../../../src/renderer/src/lib/ipc'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'

const store = () => useBrowserGuests.getState()
const invokeMock = vi.mocked(invoke)

beforeEach(() => {
  invokeMock.mockClear()
  useCoursesStore.setState({ selectedCourseId: null })
  resetBrowserGuestsForTests()
})

describe('ensureGuest', () => {
  test('creates a live guest with the initial URL and seeded nav state', () => {
    store().ensureGuest('t1', 'https://example.com')

    expect(store().liveGuests).toEqual([
      { tabId: 't1', src: 'https://example.com', isPrivate: false }
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

  test('recreates just that tab when switching between normal and private mode', () => {
    store().ensureGuest('t1', 'https://example.com')
    store().updateNav('t1', { url: 'https://example.com/account' })
    store().ensureGuest('t1', 'https://example.com/account', true)

    expect(store().liveGuests).toEqual([{
      tabId: 't1',
      src: 'https://example.com/account',
      isPrivate: true
    }])
    expect(store().nav['t1']).toEqual(initialNavState('https://example.com/account'))
  })
})

describe('anchor overlay (host DOM shown instead of the guest)', () => {
  const failure = {
    kind: 'error' as const,
    errorCode: -105,
    errorDescription: 'ERR_NAME_NOT_RESOLVED',
    url: 'https://nope.invalid'
  }

  test('a tab has no overlay until something sets one', () => {
    store().ensureGuest('t1', 'https://example.invalid')
    expect(store().overlay['t1'] ?? null).toBeNull()
  })

  test('an overlay keeps the guest alive — only its rect is withheld', () => {
    // Destroying the guest instead would turn 다시 시도 into a cold reload
    // and lose the page's history.
    store().ensureGuest('t1', 'https://example.invalid')
    store().setOverlay('t1', failure)

    expect(store().liveGuests).toEqual([
      { tabId: 't1', src: 'https://example.invalid', isPrivate: false }
    ])
    expect(store().overlay['t1']).toEqual(failure)
  })

  test('setting null dismisses it', () => {
    store().ensureGuest('t1', 'https://example.invalid')
    store().setOverlay('t1', failure)
    store().setOverlay('t1', null)
    expect(store().overlay['t1'] ?? null).toBeNull()
  })

  test('closing the tab forgets its overlay', () => {
    store().ensureGuest('t1', 'https://example.invalid')
    store().setOverlay('t1', failure)
    store().removeGuest('t1')

    expect(store().nav['t1']).toBeUndefined()
    expect(store().recent['t1']).toBeUndefined()
    expect(store().overlay['t1']).toBeUndefined()
  })

  test('overlays are per tab', () => {
    store().ensureGuest('t1', 'https://a.invalid')
    store().ensureGuest('t2', 'https://b.invalid')
    store().setOverlay('t1', failure)

    expect(store().overlay['t1']).toEqual(failure)
    expect(store().overlay['t2'] ?? null).toBeNull()
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

  test('records a visit against the immediately selected course', () => {
    useCoursesStore.setState({ selectedCourseId: 'course-current' })
    store().ensureGuest('t1', 'https://example.com')

    store().updateNav('t1', {
      url: 'https://example.com/course',
      title: 'Course home'
    })

    expect(invokeMock).toHaveBeenCalledWith('browser:recordVisit', {
      url: 'https://example.com/course',
      title: 'Course home',
      courseId: 'course-current'
    })
  })

  test('does not retain or report history for a private tab', () => {
    store().ensureGuest('private', 'https://private.example', true)

    store().updateNav('private', {
      url: 'https://private.example/secret',
      title: 'Secret'
    })

    expect(store().recent['private']).toEqual([])
    expect(invokeMock).not.toHaveBeenCalledWith(
      'browser:recordVisit',
      expect.anything()
    )
  })

  test('forgets a private tab URL when the tab is closed', () => {
    store().ensureGuest('private', 'https://private.example', true)
    store().updateNav('private', { url: 'https://private.example/secret' })
    store().removeGuest('private')

    store().ensureGuest('private', 'https://fresh.example', true)

    expect(store().nav['private']?.url).toBe('https://fresh.example')
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
