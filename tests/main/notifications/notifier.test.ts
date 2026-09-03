import { describe, expect, test, vi } from 'vitest'
import { createNotifier } from '../../../src/main/features/notifications/notifier'
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/types/settings'

function settings(over: Partial<Settings['notifications']> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...over }
  }
}

describe('createNotifier', () => {
  test('returns unsupported when the OS cannot show notifications', () => {
    const show = vi.fn()
    const notifier = createNotifier({
      getSettings: () => settings(),
      isSupported: () => false,
      isAppFocused: () => false,
      show
    })

    expect(notifier.notify({ kind: 'download', title: 't', body: 'b' })).toBe(
      'unsupported'
    )
    expect(show).not.toHaveBeenCalled()
  })

  test('returns disabled when the event switch is off', () => {
    const notifier = createNotifier({
      getSettings: () => settings({ downloads: false }),
      isSupported: () => true,
      isAppFocused: () => false,
      show: vi.fn()
    })

    expect(notifier.notify({ kind: 'download', title: 't', body: 'b' })).toBe(
      'disabled'
    )
  })

  test('suppresses the active course while the app is focused', () => {
    const notifier = createNotifier({
      getSettings: () => ({ ...settings(), lastActiveCourseId: 'course-1' }),
      isSupported: () => true,
      isAppFocused: () => true,
      show: vi.fn()
    })

    expect(
      notifier.notify({
        kind: 'agentComplete',
        title: 't',
        body: 'b',
        courseId: 'course-1'
      })
    ).toBe('suppressed')
  })

  test('sends with sound mapped to Electron silent', () => {
    const show = vi.fn()
    const notifier = createNotifier({
      getSettings: () => settings({ sound: false }),
      isSupported: () => true,
      isAppFocused: () => false,
      show
    })

    expect(notifier.notify({ kind: 'plugin', title: 't', body: 'b' })).toBe(
      'sent'
    )
    expect(show).toHaveBeenCalledWith(
      { title: 't', body: 'b', silent: true },
      undefined
    )
  })

  test('test bypasses notification switches', () => {
    const show = vi.fn()
    const notifier = createNotifier({
      getSettings: () => settings({ enabled: false }),
      isSupported: () => true,
      isAppFocused: () => true,
      show
    })

    expect(notifier.test()).toEqual({ ok: true, reason: null })
    expect(show).toHaveBeenCalledOnce()
  })
})
