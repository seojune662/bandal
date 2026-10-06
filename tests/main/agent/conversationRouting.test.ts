import { expect, test, vi } from 'vitest'
import { resolveConversationProvider } from '../../../src/main/features/agent/conversationRouting'

test('saved and explicitly selected provisional providers remain authoritative when unavailable', async () => {
  const check = vi.fn(async () => ({ installed: true, loggedIn: true }))
  expect(await resolveConversationProvider({ storedProvider: 'gemini', preferredProvider: 'codex', check })).toBe('gemini')
  expect(await resolveConversationProvider({ warmProvider: 'gemini', preferredProvider: 'codex', check })).toBe('gemini')
  expect(check).not.toHaveBeenCalled()
})
test('a new conversation skips incompatible providers and preserves preference if none are ready', async () => {
  const check = vi.fn(async (provider: string) => provider === 'codex'
    ? { installed: true, loggedIn: true, code: 'version-too-old' as const }
    : { installed: true, loggedIn: provider === 'gemini' })
  expect(await resolveConversationProvider({ preferredProvider: 'codex', check })).toBe('gemini')
  expect(check.mock.calls.map(call => call[0])).toEqual(['codex', 'claude-code', 'gemini'])
  check.mockImplementation(async () => ({ installed: true, loggedIn: false }))
  expect(await resolveConversationProvider({ preferredProvider: 'codex', check })).toBe('codex')
})
