import { afterEach, describe, expect, test, vi } from 'vitest'
import { enUS } from '../../../src/renderer/src/i18n/messages/en-US'
import { koKR } from '../../../src/renderer/src/i18n/messages/ko-KR'
import { translate } from '../../../src/renderer/src/i18n/translate'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('i18n messages', () => {
  test('Korean and English contain exactly the same keys', () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(koKR).sort())
  })

  test('interpolates strings and locale-formats numbers', () => {
    expect(
      translate('en-US', 'settings.update.downloading', { percent: 1234 })
    ).toBe('Downloading 1,234%')
    expect(
      translate('ko-KR', 'settings.university.openExternal', { name: 'eTL' })
    ).toBe('eTL 기본 브라우저로 열기')
  })

  test('falls back to Korean when the active locale is missing a key', () => {
    const key = 'settings.window.title'
    const mutableEnglish = enUS as Record<string, string>
    const original = mutableEnglish[key]
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    delete mutableEnglish[key]
    try {
      expect(translate('en-US', key)).toBe(koKR[key])
    } finally {
      if (original !== undefined) mutableEnglish[key] = original
    }
  })

  test('returns the key itself when neither locale has a message', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(translate('en-US', 'settings.missing.example')).toBe(
      'settings.missing.example'
    )
  })
})
