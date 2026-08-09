import { describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type Settings
} from '../../../src/shared/types/settings'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  onPush: vi.fn()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: ipc.invoke,
  onPush: ipc.onPush
}))

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  dataRoot: '/tmp/Bandal',
  locale: 'en-US'
}

describe('locale store', () => {
  test('hydrates from settings and applies pushed changes without reopening', async () => {
    const existingWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    let settingsChanged: ((payload: { settings: Settings }) => void) | undefined
    ipc.invoke.mockResolvedValue(settings)
    ipc.onPush.mockImplementation(
      (_channel, callback: (payload: { settings: Settings }) => void) => {
        settingsChanged = callback
        return () => undefined
      }
    )
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { bandal: {} }
    })

    try {
      const { getLocale } = await import(
        '../../../src/renderer/src/i18n/localeStore'
      )
      const { translate } = await import(
        '../../../src/renderer/src/i18n/translate'
      )
      await vi.waitFor(() => {
        expect(ipc.invoke).toHaveBeenCalledWith('settings:get', {})
        expect(getLocale()).toBe('en-US')
      })
      expect(translate(getLocale(), 'settings.category.general.label')).toBe(
        'General'
      )

      settingsChanged?.({
        settings: { ...settings, locale: 'ko-KR' }
      })

      expect(getLocale()).toBe('ko-KR')
      expect(translate(getLocale(), 'settings.category.general.label')).toBe(
        '일반'
      )
    } finally {
      if (existingWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window')
      } else {
        Object.defineProperty(globalThis, 'window', existingWindow)
      }
    }
  })
})
