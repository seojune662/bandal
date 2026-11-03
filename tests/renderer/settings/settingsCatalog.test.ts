import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SETTINGS_CATEGORIES } from '../../../src/shared/settingsCategories'
import { buildSettingsSearchIndex, paneSearchEntries } from '../../../src/renderer/src/features/settings/search/catalog'
import { SETTINGS_CATALOG_ENTRIES } from '../../../src/renderer/src/features/settings/search/entries'
import { rankSettingsSearchItems } from '../../../src/renderer/src/features/settings/search/settingsSearch'

const RENDERER = join(__dirname, '../../../src/renderer/src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'search' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

/** Every `searchId="…"` literal in renderer source (the catalog folder excluded). */
function usedSearchIds(): Set<string> {
  const ids = new Set<string>()
  for (const file of sourceFiles(RENDERER)) {
    // String literals only (`searchId="a.b"`, `searchId={'a.b'}`, `searchId: 'a.b'`);
    // forwarded variables such as `searchId={searchId}` are not ids.
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/searchId(?:=\{?|:\s*)(["'`])([\w.-]+)\1/g)) ids.add(match[2]!)
  }
  return ids
}

describe('settings search catalog', () => {
  test('ids are unique and groups point at group entries of the same category', () => {
    const byId = new Map<string, (typeof SETTINGS_CATALOG_ENTRIES)[number]>()
    for (const entry of SETTINGS_CATALOG_ENTRIES) {
      expect(byId.has(entry.id), `duplicate id ${entry.id}`).toBe(false)
      byId.set(entry.id, entry)
    }
    for (const entry of SETTINGS_CATALOG_ENTRIES) {
      if (entry.group === undefined) continue
      const group = byId.get(entry.group)
      expect(group, `${entry.id} → missing group ${entry.group}`).toBeDefined()
      expect(group?.category).toBe(entry.category)
      expect(group?.group, `${entry.group} must be a top-level group`).toBeUndefined()
    }
  })

  test('every catalog entry is rendered by some row or group (no stale search hits)', () => {
    const used = usedSearchIds()
    const stale = SETTINGS_CATALOG_ENTRIES.map(entry => entry.id).filter(id => !used.has(id))
    expect(stale).toEqual([])
  })

  test('every searchId used in a panel exists in the catalog', () => {
    const known = new Set(SETTINGS_CATALOG_ENTRIES.map(entry => entry.id))
    const unknown = [...usedSearchIds()].filter(id => !known.has(id))
    expect(unknown).toEqual([])
  })

  test('the other locale is searchable: an English word finds a Korean row', () => {
    const index = buildSettingsSearchIndex('ko-KR')
    const ranked = rankSettingsSearchItems('language', SETTINGS_CATEGORIES.map(c => c.id), id => paneSearchEntries(index, id))
    expect(ranked[0]?.item).toBe('general')
  })
})
