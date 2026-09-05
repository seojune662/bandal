import { describe, expect, test } from 'vitest'
import { searchSettings } from '../../../src/renderer/src/features/settings/settingsSearchIndex'
import { sanitizePluginManifest } from '../../../src/shared/plugins/sanitize'

describe('searchSettings', () => {
  test('matches a localized row name without case sensitivity', () => {
    expect(searchSettings('DEFAULT ZOOM', 'en-US')).toEqual([
      { category: 'browser', matches: ['Default zoom'] }
    ])
  })
  test('includes installed plugin schema titles without duplicate hits', () => {
    const manifest = sanitizePluginManifest({ manifestVersion: 2, id: 'test.search', name: 'Test', version: '1.0.0', minAppVersion: '0.41.2',
      contributes: { settings: [{ key: 'case', title: '변환 방식', type: 'boolean', default: true }] } }).manifest!
    expect(searchSettings('변환', 'ko-KR', [manifest, manifest])).toEqual([{ category: 'packs', matches: ['변환 방식'] }])
  })
})
