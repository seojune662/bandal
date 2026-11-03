// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type Settings
} from '../../../src/shared/types/settings'
import { AdvancedPanel } from '../../../src/renderer/src/features/settings/advanced/AdvancedPanel'
import { ExperimentalPanel } from '../../../src/renderer/src/features/settings/advanced/ExperimentalPanel'
import { PluginsCategoryPanel } from '../../../src/renderer/src/features/settings/PluginsCategoryPanel'
import { ConfirmDialogContext, type ConfirmFn } from '../../../src/renderer/src/components/ui/confirm-dialog-context'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'

vi.mock('../../../src/renderer/src/i18n', () => ({
  useLocale: () => 'ko-KR',
  useT: () => (key: string) => key
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: vi.fn()
}))

const disabledSettings: Settings = {
  ...DEFAULT_SETTINGS,
  experimental: {
    extensionRuntime: false,
  }
}

let mountedRoot: Root | null = null

afterEach(() => {
  if (mountedRoot !== null) {
    act(() => mountedRoot?.unmount())
    mountedRoot = null
  }
  setIpcAdapter(null)
  useUiStore.setState({ isSettingsOpen: false, settingsCategory: null })
})

describe('advanced and experimental settings', () => {
  test('asks for a destructive confirmation before resetting settings', async () => {
    const invoke = vi.fn(async () => disabledSettings)
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)
    let answer = false
    const confirm = vi.fn<ConfirmFn>(async () => answer)

    const container = document.createElement('div')
    mountedRoot = createRoot(container)
    act(() =>
      mountedRoot?.render(
        <ConfirmDialogContext.Provider value={confirm}>
          <AdvancedPanel settings={disabledSettings} />
        </ConfirmDialogContext.Provider>
      )
    )

    const resetButton = (): HTMLButtonElement | undefined =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'settings.advanced.reset.action'
      )

    await act(async () => {
      resetButton()?.click()
      await Promise.resolve()
    })
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.advanced.reset.confirmTitle',
        description: 'settings.advanced.reset.confirmDescription',
        confirmVariant: 'destructive'
      })
    )
    expect(invoke).not.toHaveBeenCalledWith('settings:reset', {})

    answer = true
    await act(async () => {
      resetButton()?.click()
      await Promise.resolve()
    })
    expect(invoke).toHaveBeenCalledWith('settings:reset', {})
  })

  test('saves a complete experimental object in the shared flag order', () => {
    const invoke = vi.fn(async () => disabledSettings)
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    const container = document.createElement('div')
    mountedRoot = createRoot(container)
    act(() => mountedRoot?.render(<ExperimentalPanel settings={disabledSettings} />))

    const switches = container.querySelectorAll<HTMLButtonElement>('[role="switch"]')
    expect(switches).toHaveLength(1)
    const labelId = switches[0]?.getAttribute('aria-labelledby') ?? ''
    expect(labelId).not.toBe('')
    expect(switches[0]?.closest('[data-settings-target]')?.getAttribute('data-settings-target')).toBe(
      'experimental.flags.extensionRuntime'
    )

    act(() => switches[0]?.click())
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      experimental: {
        extensionRuntime: true
      }
    })
  })

  test('plugin center shows a single list without a global runtime switch', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'settings:get') return disabledSettings
      if (channel === 'plugins:list') return { plugins: [] }
      if (channel === 'packs:list') return { packs: [] }
      if (channel === 'mcp:list') return { servers: [], availability: { available: false, reason: '안전한 저장소를 사용할 수 없습니다.' } }
      return undefined
    })
    setIpcAdapter({ invoke, on: vi.fn(() => () => undefined) } as unknown as IpcAdapter)
    const container = document.createElement('div')
    mountedRoot = createRoot(container)
    await act(async () => { mountedRoot?.render(<ConfirmDialogContext.Provider value={vi.fn<ConfirmFn>(async () => false)}><PluginsCategoryPanel /></ConfirmDialogContext.Provider>) })
    expect(container.querySelectorAll('.plugin-center-list')).toHaveLength(1)
    expect(container.querySelectorAll('.plugin-center-row')).toHaveLength(6)
    expect(container.querySelector('[role="switch"]')).toBeNull()
    expect(container.querySelector('.plugin-center-nav')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(invoke).not.toHaveBeenCalledWith('settings:set', expect.anything())
  })
})
