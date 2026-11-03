import { describe, expect, test } from 'vitest'
import {
  isSettingsNavigationTarget,
  toSettingsNavigationTarget
} from '../../../src/shared/settingsCategories'

describe('settings navigation target', () => {
  test('accepts a category with optional string subTab/sectionId', () => {
    expect(isSettingsNavigationTarget({ category: 'browser' })).toBe(true)
    expect(isSettingsNavigationTarget({ category: 'tabs', subTab: 'recording', sectionId: 'tabs.recording.mic' })).toBe(true)
    expect(isSettingsNavigationTarget({ category: 'mcp' })).toBe(true)
  })

  test('rejects unknown categories and malformed fields', () => {
    expect(isSettingsNavigationTarget({ category: 'nope' })).toBe(false)
    expect(isSettingsNavigationTarget({ category: 'browser', sectionId: 3 })).toBe(false)
    expect(isSettingsNavigationTarget('browser')).toBe(false)
    expect(isSettingsNavigationTarget(null)).toBe(false)
  })

  test('normalizes a bare category id', () => {
    expect(toSettingsNavigationTarget('about')).toEqual({ category: 'about' })
    expect(toSettingsNavigationTarget({ category: 'about', sectionId: 'x' })).toEqual({ category: 'about', sectionId: 'x' })
  })
})
