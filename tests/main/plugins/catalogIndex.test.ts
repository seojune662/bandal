import { describe, expect, test } from 'vitest'
import { parseCatalogIndex } from '../../../src/main/features/plugins/catalog/catalogIndex'

const SOURCE = 'https://catalog.example/plugins/index.json'

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bandal.good',
    kind: 'extension',
    name: '좋은 확장',
    publisher: 'bandal',
    description: '설명',
    tags: ['notes'],
    version: '1.2.3',
    minAppVersion: '0.36.0',
    url: 'good-1.2.3.zip',
    sha256: 'a'.repeat(64),
    ...overrides
  }
}

function index(entries: Record<string, unknown>[]): string {
  return JSON.stringify({
    format: 'bandal-plugin-catalog',
    version: 1,
    name: '테스트 카탈로그',
    entries
  })
}

describe('parseCatalogIndex', () => {
  test('keeps valid entries and drops invalid siblings', () => {
    const parsed = parseCatalogIndex(
      index([
        entry(),
        entry({ id: 'Invalid ID' }),
        entry({ id: 'bad-version', version: '1.0' }),
        entry({ id: 'bad-hash', sha256: 'A'.repeat(64) }),
        entry({ id: 'too-many-tags', tags: Array.from({ length: 9 }, () => 'tag') })
      ]),
      SOURCE,
      false
    )

    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({
      id: 'bandal.good',
      sourceUrl: SOURCE,
      verified: false
    })
  })

  test('resolves relative URLs and marks only official source entries verified', () => {
    const parsed = parseCatalogIndex(index([entry({ url: '../good.zip' })]), SOURCE, true)

    expect(parsed.entries[0]?.url).toBe('https://catalog.example/good.zip')
    expect(parsed.entries[0]?.verified).toBe(true)
  })

  test('drops artifacts whose resolved URL is not https', () => {
    const parsed = parseCatalogIndex(
      index([
        entry({ id: 'http-artifact', url: 'http://catalog.example/plugin.zip' }),
        entry({ id: 'file-artifact', url: 'file:///tmp/plugin.zip' })
      ]),
      SOURCE,
      false
    )

    expect(parsed.entries).toEqual([])
  })

  test('rejects a broken index envelope', () => {
    expect(() =>
      parseCatalogIndex(JSON.stringify({ format: 'wrong', entries: [] }), SOURCE, false)
    ).toThrow('index.json 형식')
  })
})
