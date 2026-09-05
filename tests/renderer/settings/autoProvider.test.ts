import { describe, expect, test } from 'vitest'
import type { AgentAvailability } from '../../../src/shared/types/agent-events'
import { soleConnectedProvider } from '../../../src/renderer/src/features/settings/SettingsApp'

const disconnected: AgentAvailability = { installed: true, loggedIn: false }
const connected: AgentAvailability = { installed: true, loggedIn: true }

describe('soleConnectedProvider', () => {
  test('selects the only connected provider after all probes arrive', () => {
    expect(
      soleConnectedProvider('claude-code', {
        'claude-code': disconnected,
        codex: connected,
        gemini: disconnected
      })
    ).toBe('codex')
  })

  test('does not switch before every probe arrives or when the choice is ambiguous', () => {
    expect(
      soleConnectedProvider('claude-code', {
        'claude-code': disconnected,
        codex: connected,
        gemini: null
      })
    ).toBeNull()
    expect(
      soleConnectedProvider('claude-code', {
        'claude-code': disconnected,
        codex: connected,
        gemini: connected
      })
    ).toBeNull()
    expect(
      soleConnectedProvider('codex', {
        'claude-code': disconnected,
        codex: connected,
        gemini: disconnected
      })
    ).toBeNull()
  })
})
