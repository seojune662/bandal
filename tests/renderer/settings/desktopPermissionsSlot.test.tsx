import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ScreenPermissionState } from '../../../src/shared/types/overlay'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'

const hookState = vi.hoisted(() => ({
  permission: 'unknown' as ScreenPermissionState,
  setPermission: vi.fn(),
  cleanups: [] as Array<() => void>
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: vi.fn((effect: () => void | (() => void)) => {
      const cleanup = effect()
      if (cleanup !== undefined) hookState.cleanups.push(cleanup)
    }),
    useState: vi.fn(() => [hookState.permission, hookState.setPermission])
  }
})

vi.mock('../../../src/renderer/src/i18n', () => ({
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      'settings.ai.permissions.screen.label': '화면 기록',
      'settings.ai.permissions.screen.granted': '허용됨',
      'settings.ai.permissions.screen.denied': '필요함',
      'settings.ai.permissions.screen.unknown': '미확인',
      'settings.ai.permissions.screen.open': '시스템 설정 열기',
      'settings.ai.permissions.screen.restartHint':
        '허용한 뒤에는 반달을 다시 실행해야 적용됩니다.'
    }
    return messages[key] ?? key
  }
}))

import { DesktopPermissionsSlot } from '../../../src/renderer/src/features/settings/SettingsPanels'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

function setPlatform(platform: string): void {
  vi.stubGlobal('window', { bandal: { platform } })
}

afterEach(() => {
  for (const cleanup of hookState.cleanups.splice(0)) cleanup()
  hookState.permission = 'unknown'
  hookState.setPermission.mockReset()
  setIpcAdapter(null)
  vi.unstubAllGlobals()
})

describe('DesktopPermissionsSlot', () => {
  test('renders nothing outside macOS', () => {
    setPlatform('linux')

    expect(
      renderToStaticMarkup(
        <DesktopPermissionsSlot settings={DEFAULT_SETTINGS} />
      )
    ).toBe('')
  })

  test('queries on mount and follows permission pushes on macOS', async () => {
    setPlatform('darwin')
    let pushPermission: ((payload: {
      state: ScreenPermissionState
      message: string | null
    }) => void) | null = null
    const unsubscribe = vi.fn()
    const invoke = vi.fn(async () => ({
      state: 'granted' as const,
      platform: 'darwin' as const
    }))
    setIpcAdapter({
      invoke,
      on: vi.fn((channel, handler) => {
        if (channel === 'desktopAgent:permission') {
          pushPermission = handler as typeof pushPermission
        }
        return unsubscribe
      })
    } as unknown as IpcAdapter)

    const html = renderToStaticMarkup(
      <DesktopPermissionsSlot settings={DEFAULT_SETTINGS} />
    )

    expect(html).toContain('class="setting-row"')
    expect(html).toContain('화면 기록')
    expect(html).toContain('data-state="unknown"')
    expect(html).toContain('미확인')
    expect(html).toContain('>시스템 설정 열기</button>')
    expect(invoke).toHaveBeenCalledWith('desktopAgent:permissionStatus', {})
    await vi.waitFor(() => {
      expect(hookState.setPermission).toHaveBeenCalledWith('granted')
    })

    const deliverPush = pushPermission as ((payload: {
      state: ScreenPermissionState
      message: string | null
    }) => void) | null
    deliverPush?.({ state: 'denied', message: null })
    expect(hookState.setPermission).toHaveBeenLastCalledWith('denied')

    hookState.cleanups.pop()?.()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  test('shows the restart notice only for denied permission', () => {
    setPlatform('darwin')
    hookState.permission = 'denied'
    setIpcAdapter({
      invoke: vi.fn(async () => ({
        state: 'denied' as const,
        platform: 'darwin' as const
      })),
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    const deniedHtml = renderToStaticMarkup(
      <DesktopPermissionsSlot settings={DEFAULT_SETTINGS} />
    )
    expect(deniedHtml).toContain('data-state="denied"')
    expect(deniedHtml).toContain('필요함')
    expect(deniedHtml).toContain(
      '허용한 뒤에는 반달을 다시 실행해야 적용됩니다.'
    )

    hookState.permission = 'granted'
    const grantedHtml = renderToStaticMarkup(
      <DesktopPermissionsSlot settings={DEFAULT_SETTINGS} />
    )
    expect(grantedHtml).toContain('data-state="granted"')
    expect(grantedHtml).toContain('허용됨')
    expect(grantedHtml).not.toContain(
      '허용한 뒤에는 반달을 다시 실행해야 적용됩니다.'
    )
  })
})
