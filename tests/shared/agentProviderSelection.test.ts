import { describe, expect, test } from 'vitest'
import {
  firstConnectedProvider,
  providerPreferenceOrder
} from '../../src/shared/agentProviderSelection'

describe('agent provider selection', () => {
  test('keeps the active conversation provider ahead of the last selection', () => {
    expect(providerPreferenceOrder('gemini', 'codex')).toEqual([
      'gemini',
      'codex',
      'claude-code'
    ])
  })

  test('keeps the last selection when it is connected', () => {
    const order = providerPreferenceOrder('codex', 'codex')
    expect(
      firstConnectedProvider(order, {
        'claude-code': { installed: true, loggedIn: true },
        codex: { installed: true, loggedIn: true }
      })
    ).toBe('codex')
  })

  test('falls through to another ready provider and ignores disconnected ones', () => {
    const order = providerPreferenceOrder('claude-code', 'claude-code')
    expect(
      firstConnectedProvider(order, {
        'claude-code': { installed: true, loggedIn: false },
        codex: { installed: true, loggedIn: true }
      })
    ).toBe('codex')
  })
})
