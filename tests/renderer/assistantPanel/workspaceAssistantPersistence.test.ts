// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); vi.resetModules() })
test('storage migration preserves legacy conversations when writing the new key is unavailable', async () => {
  const conversation = { conversationId: 'unsent-draft', mode: 'quiz' }
  localStorage.setItem('bandal-workspace-assistant-v1', JSON.stringify({ state: { spaces: { course: conversation } } }))
  const setItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
    if (key.startsWith('bandal:workspace-assistant:v2:')) throw new DOMException('quota', 'QuotaExceededError')
    setItem.call(this, key, value)
  })
  const { useWorkspaceAssistantStore } = await import('../../../src/renderer/src/features/assistantPanel/workspaceAssistantStore')
  expect(useWorkspaceAssistantStore.getState().spaces.course).toEqual(conversation)
  expect(localStorage.getItem('bandal-workspace-assistant-v1')).toContain('unsent-draft')
})
test('successful migration keeps a newer per-workspace selection and removes the old map', async () => {
  localStorage.setItem('bandal-workspace-assistant-v1', JSON.stringify({ state: { spaces: { course: { conversationId: 'old', mode: 'chat' } } } }))
  localStorage.setItem('bandal:workspace-assistant:v2:course', JSON.stringify({ conversationId: 'new', mode: 'flashcards' }))
  const { useWorkspaceAssistantStore } = await import('../../../src/renderer/src/features/assistantPanel/workspaceAssistantStore')
  expect(useWorkspaceAssistantStore.getState().spaces.course).toEqual({ conversationId: 'new', mode: 'flashcards' })
  expect(localStorage.getItem('bandal-workspace-assistant-v1')).toBeNull()
})
