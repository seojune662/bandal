import { describe, expect, test, vi } from 'vitest'
import type { PluginLogEntry, PluginPermission } from '../../../src/shared/types/plugin'
import type {
  HostToMain,
  PluginApiMethod
} from '../../../src/shared/types/pluginRpc'
import {
  createPluginBroker,
  type PluginApiImpl
} from '../../../src/main/features/plugins/rpcBroker'

function apiMessage(overrides: Partial<HostToMain> = {}): HostToMain {
  return {
    t: 'api',
    id: 7,
    pluginId: 'bandal.test',
    method: 'notes.read',
    args: ['note-1'],
    ...overrides
  } as HostToMain
}

function brokerFixture(options?: {
  permissions?: readonly PluginPermission[] | null
  limiterResult?: boolean
  maxPayloadBytes?: number
}) {
  const call = vi.fn(async (_pluginId: string, ...args: unknown[]) => ({ args }))
  const api = new Proxy(
    {},
    { get: () => call }
  ) as PluginApiImpl
  const logs: Array<Omit<PluginLogEntry, 'at'>> = []
  const broker = createPluginBroker({
    api,
    permissionsFor: () =>
      options !== undefined && 'permissions' in options
        ? (options.permissions ?? null)
        : ['notes.read'],
    limiter: { take: () => options?.limiterResult ?? true },
    log: (entry) => logs.push(entry),
    ...(options?.maxPayloadBytes === undefined
      ? {}
      : { maxPayloadBytes: options.maxPayloadBytes })
  })
  return { broker, call, logs }
}

describe('createPluginBroker', () => {
  test('ignores messages that are not API requests', async () => {
    const { broker } = brokerFixture()
    await expect(
      broker.handle({ t: 'ready', protocolVersion: 1 })
    ).resolves.toBeNull()
  })

  test('dispatches an allowed call with the authenticated plugin id', async () => {
    const { broker, call } = brokerFixture()

    await expect(broker.handle(apiMessage())).resolves.toEqual({
      t: 'apiResult',
      id: 7,
      ok: true,
      value: { args: ['note-1'] }
    })
    expect(call).toHaveBeenCalledWith('bandal.test', 'note-1')
  })

  test('returns permission-denied and records a denied log', async () => {
    const { broker, call, logs } = brokerFixture({ permissions: ['courses.read'] })

    const result = await broker.handle(apiMessage())

    expect(result).toMatchObject({
      t: 'apiResult',
      id: 7,
      ok: false,
      error: { code: 'permission-denied' }
    })
    expect(call).not.toHaveBeenCalled()
    expect(logs).toEqual([
      expect.objectContaining({ pluginId: 'bandal.test', level: 'denied' })
    ])
  })

  test('rejects calls when the plugin is not active', async () => {
    const { broker } = brokerFixture({ permissions: null })

    await expect(broker.handle(apiMessage())).resolves.toMatchObject({
      ok: false,
      error: { code: 'plugin-not-active' }
    })
  })

  test('returns rate-limited without invoking the API', async () => {
    const { broker, call } = brokerFixture({ limiterResult: false })

    await expect(broker.handle(apiMessage())).resolves.toMatchObject({
      ok: false,
      error: { code: 'rate-limited' }
    })
    expect(call).not.toHaveBeenCalled()
  })

  test('rejects messages larger than the configured byte budget', async () => {
    const { broker, call } = brokerFixture({ maxPayloadBytes: 64 })

    await expect(
      broker.handle(apiMessage({ args: ['x'.repeat(100)] } as Partial<HostToMain>))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'payload-too-large' }
    })
    expect(call).not.toHaveBeenCalled()
  })

  test('returns validation for an unknown method before dispatch', async () => {
    const { broker, call } = brokerFixture({ permissions: ['notes.read'] })

    await expect(
      broker.handle(
        apiMessage({ method: 'system.shell' as PluginApiMethod } as Partial<HostToMain>)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' }
    })
    expect(call).not.toHaveBeenCalled()
  })

  test('turns API exceptions into structured internal errors', async () => {
    const call = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    const api = new Proxy({}, { get: () => call }) as PluginApiImpl
    const broker = createPluginBroker({
      api,
      permissionsFor: () => ['notes.read'],
      limiter: { take: () => true },
      log: vi.fn()
    })

    await expect(broker.handle(apiMessage())).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' }
    })
  })
})
