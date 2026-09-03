import { describe, expect, test } from 'vitest'
import { createPluginRateLimiter } from '../../../src/main/features/plugins/rateLimit'
import { PLUGIN_RPC_LIMITS } from '../../../src/shared/types/pluginRpc'

describe('createPluginRateLimiter', () => {
  test('enforces the general per-plugin API budget', () => {
    const clock = { now: 0 }
    const limiter = createPluginRateLimiter(() => clock.now)

    for (let index = 0; index < PLUGIN_RPC_LIMITS.apiCallsPerWindow; index += 1) {
      expect(limiter.take('plugin-a', 'notes.read')).toBe(true)
    }
    expect(limiter.take('plugin-a', 'notes.read')).toBe(false)
    expect(limiter.take('plugin-b', 'notes.read')).toBe(true)

    clock.now += PLUGIN_RPC_LIMITS.apiWindowMs + 1
    expect(limiter.take('plugin-a', 'notes.read')).toBe(true)
  })

  test('applies the narrower notices-per-minute budget', () => {
    const clock = { now: 0 }
    const limiter = createPluginRateLimiter(() => clock.now)

    for (let index = 0; index < PLUGIN_RPC_LIMITS.noticesPerMinute; index += 1) {
      expect(limiter.take('plugin-a', 'notices.show')).toBe(true)
    }
    expect(limiter.take('plugin-a', 'notices.show')).toBe(false)

    clock.now += 60_001
    expect(limiter.take('plugin-a', 'notices.show')).toBe(true)
  })

  test('applies the fetches-per-minute budget independently per plugin', () => {
    const clock = { now: 0 }
    const limiter = createPluginRateLimiter(() => clock.now)

    for (let index = 0; index < PLUGIN_RPC_LIMITS.fetchesPerMinute; index += 1) {
      expect(limiter.take('plugin-a', 'net.fetch')).toBe(true)
    }
    expect(limiter.take('plugin-a', 'net.fetch')).toBe(false)
    expect(limiter.take('plugin-b', 'net.fetch')).toBe(true)
  })
})
