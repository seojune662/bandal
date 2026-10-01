import { describe, expect, test } from 'vitest'
import type { Favorite } from '../../../src/shared/types/favorite'
import {
  LEGACY_NEW_TAB_URL,
  browserFavoriteMatches,
  browserFavoriteShortcuts,
  hostnameForUrl,
  initialForUrl,
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

  test('filters imported bookmarks by profile and deduplicates global/course URLs', () => {
    const legacy = favorite({ id: 'legacy' })
    const school = favorite({ id: 'school-course', label: '과목 바로가기', descriptor: { kind: 'browser', payload: { tabId: 'school-tab', initialUrl: 'https://docs.example/path', profileId: 'school' } } })
    const imported = { ...school, id: 'school-global', courseId: null, label: '가져온 북마크' }
    const second = favorite({ id: 'school-extra', courseId: null, descriptor: { kind: 'browser', payload: { tabId: 'extra-tab', initialUrl: 'https://second.example', profileId: 'school' } } })
    expect(browserFavoriteShortcuts([legacy, school, imported, second], 'school')).toEqual([
      { id: 'school-course', label: '과목 바로가기', url: 'https://docs.example/path' },
      { id: 'school-extra', label: '강의 자료', url: 'https://second.example' }
    ])
    expect(browserFavoriteShortcuts([legacy, school, imported], 'default').map(item => item.id)).toEqual(['legacy'])
    expect(browserFavoriteShortcuts([legacy, school]).map(item => item.id)).toEqual(['legacy', 'school-course'])
    expect(browserFavoriteMatches(legacy, 'https://docs.example/path', 'default')).toBe(true)
    expect(browserFavoriteMatches(legacy, 'https://docs.example/path', 'school')).toBe(false)
    expect(browserFavoriteMatches(school, 'https://docs.example/path', 'school')).toBe(true)
  })
})
