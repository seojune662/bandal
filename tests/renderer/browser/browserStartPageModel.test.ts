import { describe, expect, test } from 'vitest'
import type { Favorite } from '../../../src/shared/types/favorite'
import {
  LEGACY_NEW_TAB_URL,
  browserFavoriteShortcuts,
  hostnameForUrl,
  initialForUrl,
  opensOnStartPage,
  toneForUrl
} from '../../../src/renderer/src/features/browser/browserStartPageModel'

function favorite(overrides: Partial<Favorite>): Favorite {
  return {
    id: 'favorite-1',
    courseId: 'course-1',
    label: '강의 자료',
    descriptor: {
      kind: 'browser',
      payload: { tabId: 'favorite-tab', initialUrl: 'https://docs.example/path' }
    },
    sortOrder: 0,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides
  }
}

describe('browser start-page model', () => {
  test('recognizes only the existing blank-tab marker', () => {
    expect(opensOnStartPage(LEGACY_NEW_TAB_URL)).toBe(true)
    expect(opensOnStartPage('https://google.com')).toBe(false)
    expect(opensOnStartPage('https://example.com')).toBe(false)
  })

  test('derives a local, deterministic domain mark', () => {
    expect(hostnameForUrl('https://www.example.com/path')).toBe('example.com')
    expect(initialForUrl('https://www.example.com/path')).toBe('E')
    expect(toneForUrl('https://example.com/a')).toBe(
      toneForUrl('https://example.com/b')
    )
    expect(Number(toneForUrl('https://example.com'))).toBeLessThan(6)
  })

  test('keeps only browser favorites in their stored order', () => {
    const note = favorite({
      id: 'note',
      descriptor: {
        kind: 'note',
        payload: { courseId: 'course-1', relPath: 'Week 1.md' }
      }
    })
    const browser = favorite({ id: 'browser' })

    expect(browserFavoriteShortcuts([note, browser])).toEqual([
      {
        id: 'browser',
        label: '강의 자료',
        url: 'https://docs.example/path'
      }
    ])
  })
})
