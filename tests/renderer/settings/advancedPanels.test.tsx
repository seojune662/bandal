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
  test('requires inline confirmation before resetting settings', async () => {
    const invoke = vi.fn(async () => disabledSettings)
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    const container = document.createElement('div')
    mountedRoot = createRoot(container)
    act(() => mountedRoot?.render(<AdvancedPanel settings={disabledSettings} />))

    const resetRow = container.querySelector('.settings-danger-row')
    const initialReset = resetRow?.querySelector<HTMLButtonElement>('button')
    act(() => initialReset?.click())

    expect(resetRow?.textContent).toContain('settings.advanced.reset.confirm')
    expect(invoke).not.toHaveBeenCalledWith('settings:reset', {})

    const confirmReset = Array.from(
      resetRow?.querySelectorAll<HTMLButtonElement>('button') ?? []
    ).find((button) => button.textContent === 'settings.advanced.reset.action')
    await act(async () => {
      confirmReset?.click()
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
    expect(switches[0]?.getAttribute('aria-label')).toBe(
      'settings.experimental.extensionRuntime.label'
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
    await act(async () => { mountedRoot?.render(<PluginsCategoryPanel />) })
    expect(container.querySelectorAll('.plugin-center-list')).toHaveLength(1)
    expect(container.querySelectorAll('.plugin-center-row')).toHaveLength(6)
    expect(container.querySelector('[role="switch"]')).toBeNull()
    expect(container.querySelector('.plugin-center-nav')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(invoke).not.toHaveBeenCalledWith('settings:set', expect.anything())
  })
})
