/**
 * [R3] 새 설정 3종(openAdjacentTab / restoreLastCourse / lastActiveCourseId)
 * 의 sanitizer 검증. sanitizeSettings 는 electron 없이 동작하는 순수 모듈
 * (src/main/settingsSanitize.ts)이라 Node 환경 vitest 에서 바로 부른다.
 */

import { describe, expect, test } from 'vitest'
import { sanitizeSettings } from '../../src/main/settingsSanitize'
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings'
import type { Settings } from '../../src/shared/types/settings'

const defaults: Settings = { ...DEFAULT_SETTINGS, dataRoot: '/tmp/bandal-data' }

describe('sanitizeSettings — R3 tab/course fields', () => {
  test('non-object input falls back to defaults entirely', () => {
    const result = sanitizeSettings('garbage', defaults)
    expect(result.openAdjacentTab).toBe(false)
    expect(result.restoreLastCourse).toBe(true)
    expect(result.lastActiveCourseId).toBeNull()
  })

  test('accepts valid boolean values for the two toggles', () => {
    const result = sanitizeSettings(
      { openAdjacentTab: true, restoreLastCourse: false },
      defaults
    )
    expect(result.openAdjacentTab).toBe(true)
    expect(result.restoreLastCourse).toBe(false)
  })

  test('rejects non-boolean toggle values, falling back per key', () => {
    const result = sanitizeSettings(
      { openAdjacentTab: 'yes', restoreLastCourse: 1 },
      defaults
    )
    expect(result.openAdjacentTab).toBe(false)
    expect(result.restoreLastCourse).toBe(true)
  })

  test('keeps a non-empty lastActiveCourseId string', () => {
    const result = sanitizeSettings({ lastActiveCourseId: 'course-42' }, defaults)
    expect(result.lastActiveCourseId).toBe('course-42')
  })

  test('coerces empty or non-string lastActiveCourseId to null', () => {
    expect(
      sanitizeSettings({ lastActiveCourseId: '' }, defaults).lastActiveCourseId
    ).toBeNull()
    expect(
      sanitizeSettings({ lastActiveCourseId: 7 }, defaults).lastActiveCourseId
    ).toBeNull()
    expect(
      sanitizeSettings({ lastActiveCourseId: null }, defaults).lastActiveCourseId
    ).toBeNull()
  })

  test('round-trips a full valid record unchanged', () => {
    const full: Settings = {
      ...defaults,
      openAdjacentTab: true,
      restoreLastCourse: false,
      lastActiveCourseId: 'abc'
    }
    const result = sanitizeSettings(full, defaults)
    expect(result.openAdjacentTab).toBe(true)
    expect(result.restoreLastCourse).toBe(false)
    expect(result.lastActiveCourseId).toBe('abc')
  })
})

describe('sanitizeSettings — desktop orb', () => {
  test('falls back from an unknown assistant mode to in-app', () => {
    expect(sanitizeSettings({ assistantMode: 'unknown' }, defaults).assistantMode)
      .toBe('in-app')
  })

  test('falls back from a garbage desktopOrb value to defaults', () => {
    expect(sanitizeSettings({ desktopOrb: 'garbage' }, defaults).desktopOrb)
      .toEqual({ keepAliveOnClose: true })
  })

  test('falls back from a non-boolean keepAliveOnClose to true', () => {
    expect(
      sanitizeSettings(
        { desktopOrb: { keepAliveOnClose: 'yes' } },
        defaults
      ).desktopOrb.keepAliveOnClose
    ).toBe(true)
  })
})

describe('sanitizeSettings — orbCharm', () => {
  test('accepts every registered charm id', () => {
    for (const id of ['none', 'spider', 'balloon', 'cat', 'chain']) {
      expect(sanitizeSettings({ orbCharm: id }, defaults).orbCharm).toBe(id)
    }
  })

  test.each([['spiderman'], [3], [null], [{}]])(
    'falls back to the default for %p',
    (value) => {
      expect(sanitizeSettings({ orbCharm: value }, defaults).orbCharm).toBe(
        'none'
      )
    }
  )

  test('missing key (pre-charm settings file) → none', () => {
    expect(sanitizeSettings({}, defaults).orbCharm).toBe('none')
  })
})
