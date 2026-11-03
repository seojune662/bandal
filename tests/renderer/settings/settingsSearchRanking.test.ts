import { describe, expect, test } from 'vitest'
import {
  matchesSettingsSearch,
  rankSettingsSearchItems,
  scoreSettingsSearch
} from '../../../src/renderer/src/features/settings/search/settingsSearch'

describe('settings search ranking (ported from Orca)', () => {
  test('pane title beats entry title beats description beats keywords', () => {
    const pane = [{ title: '테마' }, { title: '다른 항목' }]
    expect(scoreSettingsSearch('테마', pane)).toBe(900)
    expect(scoreSettingsSearch('테마', [{ title: '화면' }, { title: '테마' }])).toBe(700)
    expect(scoreSettingsSearch('테마', [{ title: '화면' }, { title: 'x', description: '테마' }])).toBe(500)
    expect(scoreSettingsSearch('테마', [{ title: '화면' }, { title: 'x', keywords: ['테마'] }])).toBe(300)
  })

  test('exact > prefix > substring inside a tier', () => {
    expect(scoreSettingsSearch('dark', { title: 'dark' })).toBe(700)
    expect(scoreSettingsSearch('dark', { title: 'Dark mode' })).toBe(650)
    expect(scoreSettingsSearch('dark', { title: 'Use dark mode' })).toBe(600)
  })

  test('folds case and Unicode normalization (decomposed Hangul matches)', () => {
    const decomposed = '테마'.normalize('NFD')
    expect(matchesSettingsSearch(decomposed, { title: '테마' })).toBe(true)
    expect(matchesSettingsSearch('THEME', { title: 'theme' })).toBe(true)
    expect(matchesSettingsSearch('  theme  ', { title: 'theme' })).toBe(true)
  })

  test('ranks best first, keeps original order for ties, drops non-matches', () => {
    const items = ['a', 'b', 'c', 'd']
    const entries: Record<string, { title: string; description?: string }> = {
      a: { title: 'Zoom', description: 'Default browser zoom' },
      b: { title: 'Browser' },
      c: { title: 'Unrelated' },
      d: { title: 'Browser data' }
    }
    const ranked = rankSettingsSearchItems('browser', items, item => entries[item]!)
    expect(ranked.map(r => r.item)).toEqual(['b', 'd', 'a'])
  })

  test('an empty query keeps everything in order', () => {
    expect(rankSettingsSearchItems('  ', ['x', 'y'], item => ({ title: item })).map(r => r.item)).toEqual(['x', 'y'])
  })

  test('oversized queries match nothing', () => {
    expect(matchesSettingsSearch('a'.repeat(600), { title: 'a'.repeat(600) })).toBe(false)
  })
})
