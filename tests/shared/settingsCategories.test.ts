import { expect, test } from 'vitest'
import { isSettingsCategoryId, normalizeSettingsCategoryId, SETTINGS_CATEGORIES } from '../../src/shared/settingsCategories'

test('legacy Connections routes are accepted and normalized without a second sidebar entry', () => {
  expect(isSettingsCategoryId('mcp')).toBe(true)
  expect(normalizeSettingsCategoryId('mcp')).toBe('packs')
  expect(normalizeSettingsCategoryId('general')).toBe('general')
  expect(SETTINGS_CATEGORIES.some(category => (category.id as string) === 'mcp')).toBe(false)
  expect(isSettingsCategoryId('unknown')).toBe(false)
})
