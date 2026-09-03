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
    for (const id of ['none', 'spider', 'balloon', 'cat', 'chain', 'windchime', 'yoyo']) {
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

describe('sanitizeSettings — appearance knobs', () => {
  test('accepts every registered font scale step', () => {
    for (const scale of [0.9, 1, 1.1, 1.2]) {
      expect(sanitizeSettings({ fontScale: scale }, defaults).fontScale).toBe(scale)
    }
  })

  test.each([[1.05], ['1'], [Number.NaN], [0], [null], [undefined]])(
    'falls back to 1 for a font scale of %p',
    (value) => {
      expect(sanitizeSettings({ fontScale: value }, defaults).fontScale).toBe(1)
    }
  )

  test('accepts the three editor fonts and falls back from anything else', () => {
    for (const font of ['sans', 'serif', 'mono']) {
      expect(sanitizeSettings({ editorFont: font }, defaults).editorFont).toBe(font)
    }
    expect(sanitizeSettings({ editorFont: 'comic' }, defaults).editorFont).toBe('sans')
    expect(sanitizeSettings({ editorFont: 3 }, defaults).editorFont).toBe('sans')
  })

  test('accepts both densities and falls back from anything else', () => {
    expect(sanitizeSettings({ density: 'compact' }, defaults).density).toBe('compact')
    expect(sanitizeSettings({ density: 'comfortable' }, defaults).density).toBe(
      'comfortable'
    )
    expect(sanitizeSettings({ density: 'cozy' }, defaults).density).toBe('comfortable')
    expect(sanitizeSettings({ density: null }, defaults).density).toBe('comfortable')
  })

  test('missing keys (pre-v0.36 settings file) → defaults', () => {
    const result = sanitizeSettings({ theme: 'dark' }, defaults)
    expect(result.fontScale).toBe(1)
    expect(result.editorFont).toBe('sans')
    expect(result.density).toBe('comfortable')
  })
})

describe('sanitizeSettings — keybindings and milestones', () => {
  test('keeps valid customizable chords and explicit null unbindings', () => {
    const result = sanitizeSettings(
      {
        keybindings: {
          'new-tab': 'mod+shift+n',
          'send-feedback': null
        }
      },
      defaults
    )
    expect(result.keybindings).toEqual({
      'new-tab': 'mod+shift+n',
      'send-feedback': null
    })
  })

  test('drops invalid entries individually without discarding valid siblings', () => {
    const result = sanitizeSettings(
      {
        keybindings: {
          'new-tab': 'mod+alt+t',
          'not-an-action': 'mod+x',
          'whiteboard-pen': 'mod+p',
          settings: 'mod+shift'
        }
      },
      defaults
    )
    expect(result.keybindings).toEqual({ 'new-tab': 'mod+alt+t' })
  })

  test('uses an empty keymap for missing and non-object records', () => {
    expect(sanitizeSettings({}, defaults).keybindings).toEqual({})
    expect(sanitizeSettings({ keybindings: [] }, defaults).keybindings).toEqual({})
  })

  test('keeps a milestone timestamp and defaults invalid values to null', () => {
    expect(
      sanitizeSettings(
        { milestones: { pipUsedAt: '2026-08-27T12:00:00.000Z' } },
        defaults
      ).milestones
    ).toEqual({ pipUsedAt: '2026-08-27T12:00:00.000Z' })
    expect(
      sanitizeSettings({ milestones: { pipUsedAt: 27 } }, defaults).milestones
    ).toEqual({ pipUsedAt: null })
  })
})

describe('sanitizeSettings — v0.37 notifications / browser / shortcutPriority / experimental', () => {
  test('missing blocks take the defaults', () => {
    const result = sanitizeSettings({}, defaults)
    expect(result.notifications).toEqual(DEFAULT_SETTINGS.notifications)
    expect(result.browser).toEqual(DEFAULT_SETTINGS.browser)
    expect(result.shortcutPriority).toBe('bandal')
    expect(result.experimental).toEqual(DEFAULT_SETTINGS.experimental)
  })

  test('deadline lead days are deduped, filtered to 1/3/7 and sorted descending', () => {
    const result = sanitizeSettings(
      { notifications: { deadlineLeadDays: [1, 7, 2, 'x', 7, 1] } },
      defaults
    )
    expect(result.notifications.deadlineLeadDays).toEqual([7, 1])
  })

  test('sent ledger keeps only <taskId>:<lead> → ISO entries', () => {
    const result = sanitizeSettings(
      {
        notifications: {
          sent: {
            'task-1:3': '2026-09-04T00:00:00.000Z',
            'task-1:5': '2026-09-04T00:00:00.000Z',
            'task-2:1': 'not-a-date',
            'no-colon': '2026-09-04T00:00:00.000Z'
          }
        }
      },
      defaults
    )
    expect(Object.keys(result.notifications.sent)).toEqual(['task-1:3'])
  })

  test('home page accepts absolute http(s) only and falls back to the new-tab page', () => {
    expect(sanitizeSettings({ browser: { homePage: 'https://example.com/a' } }, defaults).browser.homePage)
      .toBe('https://example.com/a')
    expect(sanitizeSettings({ browser: { homePage: 'javascript:alert(1)' } }, defaults).browser.homePage)
      .toBe('')
    expect(sanitizeSettings({ browser: { homePage: 'example.com' } }, defaults).browser.homePage)
      .toBe('')
  })

  test('default zoom must be one of the shared zoom stops', () => {
    expect(sanitizeSettings({ browser: { defaultZoomLevel: 1.22 } }, defaults).browser.defaultZoomLevel).toBe(1.22)
    expect(sanitizeSettings({ browser: { defaultZoomLevel: 1.3 } }, defaults).browser.defaultZoomLevel).toBe(0)
  })

  test('link routing and shortcut priority reject unknown values', () => {
    const result = sanitizeSettings(
      { browser: { linkRouting: 'popup' }, shortcutPriority: 'page' },
      defaults
    )
    expect(result.browser.linkRouting).toBe('in-app')
    expect(result.shortcutPriority).toBe('bandal')
    expect(sanitizeSettings({ shortcutPriority: 'site' }, defaults).shortcutPriority).toBe('site')
  })

  test('experimental drops graduated flags and fills missing ones', () => {
    const result = sanitizeSettings(
      { experimental: { extensionRuntime: false, retiredFlag: true } },
      defaults
    )
    expect(result.experimental).toEqual({ extensionRuntime: false, orbCharms: true })
    expect('retiredFlag' in result.experimental).toBe(false)
  })
})
