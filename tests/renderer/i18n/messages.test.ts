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

  test('uses localized settings navigation labels', () => {
    expect(translate('ko-KR', 'settings.back')).toBe('앱으로 돌아가기')
    expect(translate('ko-KR', 'settings.eyebrow')).toBe('반달 설정')
    expect(translate('ko-KR', 'settings.tagline')).toBe(
      '내 리듬대로 공부해요.'
    )
    expect(translate('ko-KR', 'settings.group.settings')).toBe('설정')
    expect(translate('ko-KR', 'settings.group.workspace')).toBe('학습 공간')
    expect(translate('ko-KR', 'settings.group.info')).toBe('정보')
    expect(translate('ko-KR', 'settings.category.general.label')).toBe('일반')
    expect(translate('ko-KR', 'settings.category.appearance.label')).toBe('화면')
    expect(translate('ko-KR', 'settings.category.university.label')).toBe('학교')
    expect(translate('ko-KR', 'settings.category.courses.label')).toBe('과목')
    expect(translate('ko-KR', 'settings.category.about.label')).toBe('정보')
    expect(translate('en-US', 'settings.category.general.label')).toBe('General')
  })

  test('describes the current locale scope in both languages', () => {
    expect(translate('ko-KR', 'settings.general.locale.scope')).toBe(
      '현재는 설정 화면에만 적용됩니다.'
    )
    expect(translate('en-US', 'settings.general.locale.scope')).toBe(
      'Currently, this applies only to the Settings screen.'
    )
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
