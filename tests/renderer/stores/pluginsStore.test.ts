import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PushPayload } from '../../../src/shared/ipc/events'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import {
  chordMap,
  commandsById,
  panelsById,
  resetPluginsStoreForTests,
  usePluginsStore
} from '../../../src/renderer/src/stores/pluginsStore'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

const plugin: PluginSummary = {
  manifest: {
    manifestVersion: 1,
    id: 'study.tools',
    name: 'Study Tools',
    version: '1.0.0',
    minAppVersion: '0.35.0',
    description: 'Study helpers',
    author: 'Bandal Lab',
    main: 'main.js',
    permissions: ['commands', 'panel'],
    contributes: {
      commands: [
        { id: 'summarize', title: 'Summarize', defaultChord: 'mod+shift+s' }
      ],
      panels: [{ id: 'dashboard', title: 'Dashboard', entry: 'index.html' }]
    },
    styles: null
  },
  enabled: true,
  state: 'active',
  approvedPermissions: ['commands', 'panel'],
  installedAt: '2026-09-01T00:00:00.000Z',
  lastError: null
}

afterEach(() => {
  setIpcAdapter(null)
  resetPluginsStoreForTests()
})

describe('pluginsStore', () => {
  test('mirrors list and changed pushes', async () => {
    let changed: ((payload: PushPayload<'plugins:changed'>) => void) | null = null
    setIpcAdapter({
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'plugins:list') return { plugins: [plugin] }
        throw new Error(`Unexpected IPC channel: ${channel}`)
      }),
      on: vi.fn((channel: string, callback: unknown) => {
        if (channel === 'plugins:changed') {
          changed = callback as (payload: PushPayload<'plugins:changed'>) => void
        }
        return () => undefined
      })
    } as unknown as IpcAdapter)

    await usePluginsStore.getState().refresh()
    expect(usePluginsStore.getState().plugins).toEqual([plugin])

    changed?.({ plugins: [{ ...plugin, enabled: false, state: 'disabled' }] })
    expect(usePluginsStore.getState().plugins[0]?.state).toBe('disabled')
  })

  test('indexes contributions and applies a plugin keybinding override', () => {
    const state = { plugins: [plugin] }
    expect(commandsById(state).get('plugin:study.tools:summarize')?.command.title)
      .toBe('Summarize')
    expect(panelsById(state).get('plugin-panel:study.tools:dashboard')?.panel.entry)
      .toBe('index.html')

    const chords = chordMap(state, {
      'plugin:study.tools:summarize': 'mod+alt+k'
    })
    expect(chords.get('mod+alt+k')?.command.id).toBe('summarize')
    expect(chords.has('mod+shift+s')).toBe(false)
  })

  test('runs a command through the typed IPC route', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await usePluginsStore.getState().runCommand('study.tools', 'summarize')
    expect(invoke).toHaveBeenCalledWith('plugins:runCommand', {
      pluginId: 'study.tools',
      commandId: 'summarize'
    })
  })
})
