import { describe, expect, test } from 'vitest'
import {
  addressDisplayParts,
  resolveAddressInput,
  suggestionsFor,
  type SearchEngineId
} from '../../../src/renderer/src/features/browser/urlInput'

describe('resolveAddressInput', () => {
  test('passes full URLs through unchanged', () => {
    expect(resolveAddressInput('https://example.com/a?b=1')).toBe(
      'https://example.com/a?b=1'
    )
    expect(resolveAddressInput('http://localhost:5173')).toBe(
      'http://localhost:5173'
    )
  })

  test('defaults bare domains to https', () => {
    expect(resolveAddressInput('example.com')).toBe('https://example.com')
    expect(resolveAddressInput('  docs.example.co.kr/path  ')).toBe(
      'https://docs.example.co.kr/path'
    )
  })

  test('turns non-URL input into a search query', () => {
    expect(resolveAddressInput('푸리에 변환')).toBe(
      `https://www.google.com/search?q=${encodeURIComponent('푸리에 변환')}`
    )
    expect(resolveAddressInput('two words')).toBe(
      'https://www.google.com/search?q=two%20words'
    )
  })

  test('returns null for empty input', () => {
    expect(resolveAddressInput('')).toBeNull()
    expect(resolveAddressInput('   ')).toBeNull()
  })
})

describe('addressDisplayParts', () => {
  test('decodes percent-encoded Korean paths for display', () => {
    const parts = addressDisplayParts(
      'https://ist.snu.ac.kr/%EA%B3%B5%EA%B0%84%EC%98%88%EC%95%BD'
    )
    expect(parts.domain).toBe('ist.snu.ac.kr')
    expect(parts.suffix).toBe('/공간예약')
    expect(parts.secure).toBe(true)
  })

  test('hides https scheme and www prefix, keeps http visible', () => {
    expect(addressDisplayParts('https://www.google.com/')).toEqual({
      prefix: '',
      domain: 'google.com',
      suffix: '',
      secure: true
    })
    expect(addressDisplayParts('http://example.com/a').prefix).toBe('http://')
  })

  test('keeps malformed percent sequences as-is', () => {
    const parts = addressDisplayParts('https://a.b/%E0%A4%A')
    expect(parts.suffix).toBe('/%E0%A4%A')
  })
})

describe('resolveAddressInput — search engines', () => {
  test('routes a query to the chosen engine', () => {
    expect(resolveAddressInput('해시 충돌', 'naver')).toBe(
      'https://search.naver.com/search.naver?query=%ED%95%B4%EC%8B%9C%20%EC%B6%A9%EB%8F%8C'
    )
    expect(resolveAddressInput('해시', 'duckduckgo')).toContain('duckduckgo.com')
  })

  test('an unknown engine falls back rather than producing a broken URL', () => {
    expect(
      resolveAddressInput('x', 'bing' as unknown as SearchEngineId)
    ).toContain('google.com')
  })

  test('a URL is never sent to a search engine', () => {
    expect(resolveAddressInput('myetl.snu.ac.kr', 'naver')).toBe(
      'https://myetl.snu.ac.kr'
    )
  })
})

describe('suggestionsFor', () => {
  const sources = {
    history: [
      {
        url: 'https://myetl.snu.ac.kr/courses/12345',
        title: '자료구조',
        host: 'myetl.snu.ac.kr'
      },
      {
        url: 'https://blog.example.com/myetl-review',
        title: 'myetl 후기',
        host: 'blog.example.com'
      }
    ],
    favorites: [{ label: '학사정보', url: 'https://portal.snu.ac.kr' }],
    services: [{ label: 'eTL', url: 'https://myetl.snu.ac.kr' }],
    openTabs: [{ title: '자료구조 3주차', url: 'https://myetl.snu.ac.kr/w3' }]
  }

  test('empty input offers local shortcuts without a web search', () => {
    const items = suggestionsFor('   ', sources)
    expect(items.some((item) => item.kind === 'favorite')).toBe(true)
    expect(items.some((item) => item.kind === 'search')).toBe(false)
  })

  test('what was typed comes first, so ↵ is never a surprise', () => {
    const first = suggestionsFor('myetl.snu.ac.kr', sources)[0]
    expect(first?.kind).toBe('url')
    expect(first?.url).toBe('https://myetl.snu.ac.kr')
  })

  test('a plain query keeps web search first as history arrives', () => {
    const items = suggestionsFor('자료', sources)
    expect(items.some((item) => item.kind === 'search')).toBe(true)
    expect(items[0]?.kind).toBe('search')
  })

  test('things the student already chose outrank history', () => {
    const kinds = suggestionsFor('myetl', sources).map((item) => item.kind)
    expect(kinds.indexOf('tab')).toBeLessThan(kinds.indexOf('history'))
    expect(kinds.indexOf('favorite')).toBeLessThan(kinds.indexOf('history'))
  })

  test('a host being typed floats above a merely matching page', () => {
    const history = suggestionsFor('myetl', sources).filter(
      (item) => item.kind === 'history'
    )
    // The blog merely mentions "myetl"; the portal IS myetl.snu.ac.kr.
    expect(history[0]?.url).toBe('https://myetl.snu.ac.kr/courses/12345')
  })

  test('the same URL never appears twice', () => {
    const urls = suggestionsFor('snu', sources).map((item) => item.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  test('falls back to the URL when a history entry has no title', () => {
    const items = suggestionsFor('untitled', {
      ...sources,
      history: [
        { url: 'https://untitled.ac.kr/x', title: '', host: 'untitled.ac.kr' }
      ]
    })
    expect(items.some((item) => item.label === 'https://untitled.ac.kr/x')).toBe(
      true
    )
  })

  test('requires all words, across both title and address', () => {
    const items = suggestionsFor('snu 자료구조', sources)
    expect(items.filter((item) => item.kind !== 'search').map((item) => item.label))
      .toEqual(['자료구조 3주차', '자료구조'])
  })

  test('filters unrelated history and matches decoded Korean paths', () => {
    const items = suggestionsFor('공간예약', { ...sources, history: [
      ...sources.history,
      { url: 'https://snu.ac.kr/%EA%B3%B5%EA%B0%84%EC%98%88%EC%95%BD', title: 'SNU', host: 'snu.ac.kr' }
    ] })
    expect(items.map((item) => item.kind)).toEqual(['search', 'history'])
    expect(items[1]?.label).toBe('SNU')
  })

  test('deduplicates equivalent root URLs but preserves video parameters', () => {
    const items = suggestionsFor('youtube', { ...sources, openTabs: [], services: [],
      favorites: [{ label: 'YouTube', url: 'https://youtube.com' }],
      history: [
        { url: 'https://youtube.com/', title: 'Home', host: 'youtube.com' },
        { url: 'https://youtube.com/watch?v=one', title: 'One', host: 'youtube.com' },
        { url: 'https://youtube.com/watch?v=two', title: 'Two', host: 'youtube.com' }
      ]
    })
    expect(items.map((item) => item.kind)).toEqual(['search', 'favorite', 'history', 'history'])
    expect(items.at(-1)?.url).toBe('https://youtube.com/watch?v=two')
  })

  test('is bounded so the dropdown cannot run off screen', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      url: `https://a${i}.ac.kr/`,
      title: `page ${i}`,
      host: `a${i}.ac.kr`
    }))
    expect(suggestionsFor('a', { ...sources, history: many })).toHaveLength(8)
  })
})
