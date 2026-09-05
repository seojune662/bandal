import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UtilityProcess } from 'electron'
import type {
  PluginState,
  PluginSummary
} from '../../../src/shared/types/plugin'
import type { MainToHost } from '../../../src/shared/types/pluginRpc'
import type { PluginStore } from '../../../src/main/features/plugins/pluginStore'
import type { PluginApiImpl } from '../../../src/main/features/plugins/rpcBroker'

const electronMocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({
  utilityProcess: { fork: electronMocks.fork }
}))

import { createPluginRuntime } from '../../../src/main/features/plugins/pluginRuntime'
import { createPluginLog } from '../../../src/main/features/plugins/pluginLog'
import { createPluginRateLimiter } from '../../../src/main/features/plugins/rateLimit'

const basePlugin: PluginSummary = {
  manifest: {
    manifestVersion: 1,
    id: 'bandal.runtime-manager',
    name: 'Runtime Manager',
    version: '1.0.0',
    minAppVersion: '0.36.0',
    description: 'runtime manager fixture',
    author: 'Bandal',
    main: 'main.js',
    permissions: ['commands', 'notes.read', 'events', 'panel'],
    contributes: {
      commands: [{ id: 'run', title: 'Run', defaultChord: null }],
      panels: [{ id: 'main', title: 'Main', entry: 'index.html' }]
    },
    styles: null
  },
  enabled: true,
  state: 'starting',
  approvedPermissions: ['commands', 'notes.read', 'events', 'panel'],
  installedAt: '2026-09-03T00:00:00.000Z',
  lastError: null
}

class FakeChild extends EventEmitter {
  readonly sent: MainToHost[] = []
  stdout = null
  stderr = null
  pid = 42

  postMessage(message: MainToHost): void {
    this.sent.push(message)
  }

  kill(): boolean {
    this.pid = undefined as unknown as number
    return true
  }
}

function fixture(options: { appVersion?: string } = {}) {
  let plugin = structuredClone(basePlugin)
  const child = new FakeChild()
  electronMocks.fork.mockReturnValue(child as unknown as UtilityProcess)
  const store = {
    list: () => [structuredClone(plugin)],
    get: (id: string) =>
      id === plugin.manifest.id ? structuredClone(plugin) : null,
    needsApproval: () => false,
    dirFor: (id: string) => `/plugins/${id}`,
    setState: (id: string, state: PluginState, lastError?: string | null) => {
      if (id !== plugin.manifest.id) throw new Error('missing')
      plugin = {
        ...plugin,
        state,
        ...(lastError === undefined ? {} : { lastError })
      }
      return structuredClone(plugin)
    }
  } as unknown as PluginStore
  const apiCall = vi.fn(async () => ({ content: 'hello' }))
  const api = new Proxy({}, { get: () => apiCall }) as PluginApiImpl
  const changed = vi.fn()
  const runtime = createPluginRuntime({
    store,
    api,
    limiter: createPluginRateLimiter(),
    log: createPluginLog({ warn: vi.fn() }),
    hostEntry: '/app/pluginHost.js',
    appVersion: options.appVersion ?? '0.36.0',
    changed
  })
  return { apiCall, changed, child, get plugin() { return plugin }, runtime }
}

async function activate(harness: ReturnType<typeof fixture>): Promise<void> {
  const loading = harness.runtime.load(basePlugin.manifest.id)
  harness.child.emit('message', { t: 'ready', protocolVersion: 1 })
  await vi.waitFor(() => {
    expect(harness.child.sent.some((message) => message.t === 'load')).toBe(true)
  })
  harness.child.emit('message', {
    t: 'activated',
    pluginId: basePlugin.manifest.id,
    ok: true,
    commands: ['run']
  })
  await loading
}

beforeEach(() => electronMocks.fork.mockReset())

describe('createPluginRuntime', () => {
  test('does not inherit application secrets or Node preload options', async () => {
    vi.stubEnv('BANDAL_TEST_SECRET', 'secret-value')
    vi.stubEnv('NODE_OPTIONS', '--require=untrusted.js')
    const harness = fixture()
    try {
      await activate(harness)
      const options = electronMocks.fork.mock.calls[0]?.[2]
      expect(options.env).not.toHaveProperty('BANDAL_TEST_SECRET')
      expect(options.env).not.toHaveProperty('NODE_OPTIONS')
      expect(options.execArgv).toEqual(['--max-old-space-size=128'])
    } finally { harness.runtime.dispose(); vi.unstubAllEnvs() }
  })
  test('a plugin crash cannot terminate another plugin host or forge its messages', async () => {
    const plugins = new Map(['test.first', 'test.second'].map((id) => [id, { ...structuredClone(basePlugin), manifest: { ...structuredClone(basePlugin.manifest), id } }]))
    const children: FakeChild[] = []
    electronMocks.fork.mockImplementation(() => { const child = new FakeChild(); children.push(child); return child })
    const store = { list: () => [...plugins.values()], get: (id: string) => plugins.get(id) ?? null, needsApproval: () => false,
      dirFor: (id: string) => `/plugins/${id}`, setState: (id: string, state: PluginState, lastError: string | null = null) => {
        const plugin = { ...plugins.get(id)!, state, lastError }; plugins.set(id, plugin); return plugin
      } } as unknown as PluginStore
    const runtime = createPluginRuntime({ store, api: new Proxy({}, { get: () => vi.fn() }) as PluginApiImpl,
      limiter: createPluginRateLimiter(), log: createPluginLog({ warn: vi.fn() }), hostEntry: '/host.js', appVersion: '0.41.2', changed: vi.fn() })
    for (const id of plugins.keys()) {
      const loading = runtime.load(id)
      const child = children.at(-1)!
      child.emit('message', { t: 'ready', protocolVersion: 1 })
      await vi.waitFor(() => expect(child.sent.some((m) => m.t === 'load')).toBe(true))
      child.emit('message', { t: 'activated', pluginId: id, ok: true, commands: ['run'] })
      await loading
    }
    expect(children).toHaveLength(2)
    children[0]!.emit('exit', 1)
    expect(plugins.get('test.first')?.state).toBe('errored')
    expect(plugins.get('test.second')?.state).toBe('active')
    runtime.dispose()
  })
  test('allows approved APIs during activation and rejects a forged plugin identity', async () => {
    const harness = fixture()
    const loading = harness.runtime.load(basePlugin.manifest.id)
    harness.child.emit('message', { t: 'ready', protocolVersion: 1 })
    await vi.waitFor(() => expect(harness.child.sent.some((m) => m.t === 'load')).toBe(true))
    harness.child.emit('message', { t: 'api', id: 20, pluginId: basePlugin.manifest.id, method: 'notes.read', args: ['note'] })
    harness.child.emit('message', { t: 'api', id: 21, pluginId: 'another.plugin', method: 'notes.read', args: ['private'] })
    await vi.waitFor(() => expect(harness.apiCall).toHaveBeenCalledTimes(1))
    harness.child.emit('message', { t: 'activated', pluginId: basePlugin.manifest.id, ok: true, commands: [] })
    await loading
    harness.runtime.dispose()
  })
  test('loads an approved plugin after the host handshake', async () => {
    const harness = fixture()
    await activate(harness)

    expect(harness.plugin.state).toBe('active')
    expect(harness.changed).toHaveBeenCalled()
    expect(harness.child.sent).toContainEqual(
      expect.objectContaining({
        t: 'load',
        pluginId: basePlugin.manifest.id,
        dir: `/plugins/${basePlugin.manifest.id}`
      })
    )
    harness.runtime.dispose()
  })

  test('brokers API calls and resolves command results', async () => {
    const harness = fixture()
    await activate(harness)

    harness.child.emit('message', {
      t: 'api',
      id: 7,
      pluginId: basePlugin.manifest.id,
      method: 'notes.read',
      args: ['note-1']
    })
    await vi.waitFor(() => {
      expect(harness.child.sent).toContainEqual({
        t: 'apiResult',
        id: 7,
        ok: true,
        value: { content: 'hello' }
      })
    })
    expect(harness.apiCall).toHaveBeenCalledWith(
      basePlugin.manifest.id,
      'note-1'
    )

    const command = harness.runtime.runCommand(basePlugin.manifest.id, 'run')
    let request: Extract<MainToHost, { t: 'command' }> | undefined
    await vi.waitFor(() => {
      request = harness.child.sent.find(
        (message): message is Extract<MainToHost, { t: 'command' }> =>
          message.t === 'command'
      )
      expect(request).toBeDefined()
    })
    harness.child.emit('message', {
      t: 'commandResult',
      id: request!.id,
      pluginId: basePlugin.manifest.id,
      ok: true
    })
    await expect(command).resolves.toBeUndefined()
    harness.runtime.dispose()
  })

  test('refuses a plugin that requires a newer app before forking', async () => {
    const harness = fixture({ appVersion: '0.35.0' })

    await expect(harness.runtime.load(basePlugin.manifest.id)).rejects.toThrow(
      'requires Bandal 0.36.0'
    )
    expect(electronMocks.fork).not.toHaveBeenCalled()
    expect(harness.plugin.state).toBe('errored')
  })
})
