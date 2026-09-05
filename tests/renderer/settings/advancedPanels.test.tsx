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
  useT: () => (key: string) => key
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: vi.fn()
}))

vi.mock('../../../src/renderer/src/features/settings/PacksPanel', () => ({
  PacksPanel: () => 'packs mounted'
}))

vi.mock('../../../src/renderer/src/features/settings/ExtensionsPanel', () => ({
  ExtensionsPanel: () => 'extensions mounted'
}))

const disabledSettings: Settings = {
  ...DEFAULT_SETTINGS,
  experimental: {
    extensionRuntime: false,
    orbCharms: true
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
    expect(switches).toHaveLength(2)
    expect(switches[0]?.getAttribute('aria-label')).toBe(
      'settings.experimental.extensionRuntime.label'
    )
    expect(switches[1]?.getAttribute('aria-label')).toBe(
      'settings.experimental.orbCharms.label'
    )

    act(() => switches[0]?.click())
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      experimental: {
        extensionRuntime: true,
        orbCharms: true
      }
    })
  })

  test('plugin-system switch mirrors extensionRuntime and follows settings changes', async () => {
    let publishSettings = (_settings: Settings): void => undefined
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'settings:get' || channel === 'settings:set') return disabledSettings
      if (channel === 'plugins:list') return { plugins: [] }
      if (channel === 'packs:list') return { packs: [] }
      if (channel === 'plugins:catalog') return { sources: [], entries: [], fetchedAt: null }
      return undefined
    })
    setIpcAdapter({
      invoke,
      on: vi.fn(
        (
          channel: string,
          callback: (payload: { settings: Settings }) => void
        ) => {
          if (channel === 'settings:changed') {
            publishSettings = (settings) => callback({ settings })
          }
          return () => undefined
        }
      )
    } as unknown as IpcAdapter)

    const container = document.createElement('div')
    mountedRoot = createRoot(container)
    await act(async () => {
      mountedRoot?.render(<PluginsCategoryPanel />)
      await Promise.resolve()
    })

    // The development section keeps both management panels mounted.
    expect(container.textContent).toContain('packs mounted')
    expect(container.textContent).toContain('extensions mounted')

    const master = container.querySelector<HTMLButtonElement>('[role="switch"]')
    expect(master?.getAttribute('aria-checked')).toBe('false')
    act(() => master?.click())
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      experimental: { ...disabledSettings.experimental, extensionRuntime: true }
    })

    act(() => {
      publishSettings({
        ...disabledSettings,
        experimental: { ...disabledSettings.experimental, extensionRuntime: true }
      })
    })
    expect(
      container.querySelector<HTMLButtonElement>('[role="switch"]')?.getAttribute('aria-checked')
    ).toBe('true')
  })
})
