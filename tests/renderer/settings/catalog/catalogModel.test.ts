import { describe, expect, test } from 'vitest'
import type { CatalogEntry } from '../../../../src/shared/types/pluginCatalog'
import {
  filterEntries,
  installState
} from '../../../../src/renderer/src/features/settings/catalog/catalogModel'

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'notes.tools',
    kind: 'extension',
    name: 'Notes Tools',
    publisher: 'Bandal Labs',
    description: 'Note utilities',
    tags: ['notes', 'study'],
    version: '2.0.0',
    minAppVersion: null,
    url: 'https://bandal.io/plugins/notes.zip',
    sha256: 'a'.repeat(64),
    sourceUrl: 'https://bandal.io/plugins/index.json',
    verified: true,
    ...overrides
  }
}

describe('catalogModel', () => {
  test('filters by metadata and distinguishes extension and pack installs', () => {
    const entries = [
      entry(),
      entry({
        id: 'review',
        kind: 'pack',
        name: 'Review Pack',
        publisher: 'Study Club',
        tags: ['exam']
      })
    ]

    expect(filterEntries(entries, {
      query: 'BANDAL',
      installedOnly: false,
      installedIds: new Set(),
      installedPackNames: new Set()
    })).toEqual([entries[0]])
    expect(filterEntries(entries, {
      query: '',
      installedOnly: true,
      installedIds: new Set(['notes.tools']),
      installedPackNames: new Set(['Review Pack'])
    })).toEqual(entries)
  })

  test('uses semantic versions to expose catalog updates', () => {
    const catalogEntry = entry()

    expect(installState(catalogEntry, null)).toBe('install')
    expect(installState(catalogEntry, '2.0.0')).toBe('installed')
    expect(installState(catalogEntry, '1.9.0')).toBe('update')
    expect(installState(catalogEntry, '3.0.0')).toBe('installed')
  })
})
