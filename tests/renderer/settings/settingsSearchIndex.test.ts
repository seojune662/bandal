import { describe, expect, test } from 'vitest'
import { searchSettings } from '../../../src/renderer/src/features/settings/settingsSearchIndex'

describe('searchSettings', () => {
  test('matches a localized row name without case sensitivity', () => {
    expect(searchSettings('DEFAULT ZOOM', 'en-US')).toEqual([
      { category: 'browser', matches: ['Default zoom'] }
    ])
  })
})
