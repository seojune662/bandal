import { expect, test } from 'vitest'
import { isSettingsCategoryId, normalizeSettingsCategoryId, SETTINGS_CATEGORIES, SETTINGS_SECTIONS, settingsSectionOf, settingsSectionPanels } from '../../src/shared/settingsCategories'

test('legacy Connections routes are accepted and normalized without a second sidebar entry', () => {
  expect(isSettingsCategoryId('mcp')).toBe(true)
  expect(normalizeSettingsCategoryId('mcp')).toBe('packs')
  expect(normalizeSettingsCategoryId('general')).toBe('general')
  expect(SETTINGS_CATEGORIES.some(category => (category.id as string) === 'mcp')).toBe(false)
  expect(isSettingsCategoryId('unknown')).toBe(false)
})

test('every panel shows in exactly one sidebar section, and a panel id opens that section', () => {
  const placed = SETTINGS_SECTIONS.flatMap(section => section.panels as readonly string[])
  expect([...placed].sort()).toEqual(SETTINGS_CATEGORIES.map(category => category.id).sort())
  expect(new Set(placed).size).toBe(placed.length)
  expect(settingsSectionOf('tabs')).toBe('appearance')
  expect(settingsSectionOf('university')).toBe('account')
  expect(settingsSectionOf('browser')).toBe('integrations')
  expect(settingsSectionOf('sync')).toBe('sync')
  expect(settingsSectionPanels('privacy')).toEqual(['permissions', 'privacy'])
})
