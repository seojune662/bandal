import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Session, WebContents } from 'electron'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import type { PluginStore } from '../../../src/main/features/plugins/pluginStore'

const electronMocks = vi.hoisted(() => ({ fromPartition: vi.fn() }))
vi.mock('electron', () => ({
  session: { fromPartition: electronMocks.fromPartition }
}))

import {
  attachPluginPanelGuest,
  configurePluginPanels,
  postPluginPanelMessage,
  preparePluginPanelWebview
} from '../../../src/main/features/plugins/pluginPanels'

const plugin: PluginSummary = {
  manifest: {
    manifestVersion: 1,
    id: 'bandal.panel-test',
    name: 'Panel Test',
    version: '1.0.0',
    minAppVersion: '0.36.0',
    description: 'panel fixture',
    author: 'Bandal',
    main: 'main.js',
    permissions: ['panel'],
    contributes: {
      commands: [],
      panels: [{ id: 'main', title: 'Main', entry: 'index.html' }]
    },
    styles: null
  },
  enabled: true,
  state: 'active',
  approvedPermissions: ['panel'],
  installedAt: '2026-09-03T00:00:00.000Z',
  lastError: null
}

class FakeGuest extends EventEmitter {
  readonly send = vi.fn()
  readonly session: Session
  private readonly url: string

  constructor(sessionValue: Session, url: string) {
    super()
    this.session = sessionValue
    this.url = url
  }

  getURL(): string {
    return this.url
  }

  setWindowOpenHandler = vi.fn()
  isDestroyed(): boolean {
    return false
  }
}

const stops: Array<() => void> = []
afterEach(() => {
  while (stops.length > 0) stops.pop()?.()
  electronMocks.fromPartition.mockReset()
})

describe('plugin panel guests', () => {
  test('forces a sandboxed preload and carries messages in both directions', () => {
    const protocolHandle = vi.fn()
    const panelSession = {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      protocol: { handle: protocolHandle }
    } as unknown as Session
    electronMocks.fromPartition.mockReturnValue(panelSession)
    const store = {
      get: (id: string) => (id === plugin.manifest.id ? plugin : null),
      manifestFor: (id: string) =>
        id === plugin.manifest.id ? plugin.manifest : null,
      dirFor: (id: string) => `/plugins/${id}`
    } as unknown as PluginStore
    const onPanelMessage = vi.fn()
    stops.push(
      configurePluginPanels({
        store,
        preloadPath: '/app/pluginPanel.js',
        onPanelMessage,
        log: vi.fn()
      })
    )

    const params = {
      src: 'bandal-plugin://bandal.panel-test/ui/index.html',
      partition: 'plugin:bandal.panel-test',
      preload: '/attacker.js'
    }
    const preferences: Record<string, unknown> = {
      nodeIntegration: true,
      preload: '/attacker.js'
    }
    expect(preparePluginPanelWebview(params, preferences)).toBe(true)
    expect(preferences).toMatchObject({
      preload: '/app/pluginPanel.js',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: 'plugin:bandal.panel-test'
    })
    expect(params).not.toHaveProperty('preload')
    expect(protocolHandle).toHaveBeenCalledOnce()

    const guest = new FakeGuest(panelSession, params.src)
    expect(attachPluginPanelGuest(guest as unknown as WebContents)).toBe(true)
    guest.emit('ipc-message', {}, 'bandal-plugin:message', { refresh: true })
    expect(onPanelMessage).toHaveBeenCalledWith(
      'bandal.panel-test',
      'main',
      { refresh: true }
    )

    postPluginPanelMessage('bandal.panel-test', 'main', { rows: [1] })
    expect(guest.send).toHaveBeenCalledWith(
      'bandal-plugin:message',
      { rows: [1] }
    )
  })

  test('rejects foreign partitions and undeclared panel entries', () => {
    const store = {
      get: () => plugin,
      manifestFor: () => plugin.manifest,
      dirFor: () => '/plugins/bandal.panel-test'
    } as unknown as PluginStore
    stops.push(
      configurePluginPanels({
        store,
        preloadPath: '/app/pluginPanel.js',
        onPanelMessage: vi.fn(),
        log: vi.fn()
      })
    )

    expect(
      preparePluginPanelWebview(
        {
          src: 'bandal-plugin://bandal.panel-test/ui/index.html',
          partition: 'persist:browsing'
        },
        {}
      )
    ).toBe(false)
    expect(
      preparePluginPanelWebview(
        {
          src: 'bandal-plugin://bandal.panel-test/ui/secret.html',
          partition: 'plugin:bandal.panel-test'
        },
        {}
      )
    ).toBe(false)
  })
})
