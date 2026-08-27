import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'

const pushCallbacks = new Map<string, (payload: unknown) => void>()

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn((channel: string, callback: (payload: unknown) => void) => {
    pushCallbacks.set(channel, callback)
    return () => pushCallbacks.delete(channel)
  })
}))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  installPipMilestoneTracking,
  useMilestones
} from '../../../src/renderer/src/features/help/milestonesStore'

const invokeMock = vi.mocked(invoke)

afterEach(() => {
  vi.clearAllMocks()
  pushCallbacks.clear()
  delete (globalThis as { window?: Window }).window
})

describe('PiP milestone tracking', () => {
  test('records the first open push with the milestones settings patch', async () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      milestones: { pipUsedAt: '2026-08-27T12:00:00.000Z' }
    }
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS
      if (channel === 'settings:set') return saved
      throw new Error(`Unexpected channel: ${channel}`)
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {}
    })

    installPipMilestoneTracking()
    pushCallbacks.get('pip:state')?.({
      open: true,
      source: null,
      positionSec: 0,
      playbackRate: 1,
      paused: true
    })

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('settings:set', {
        milestones: { pipUsedAt: expect.any(String) }
      })
    })
    expect(useMilestones.getState().facts.pip).toBe(true)
  })
})
