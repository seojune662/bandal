/**
 * Cross-feature hook for pushing a prompt into a conversation's chat composer
 * — e.g. M5's annotation → "이 부분 설명해줘" flow. Callers use
 * `requestChatPrompt(conversationId, prompt)`; the mounted chat surface for
 * that conversation consumes it, prefills the composer and focuses it.
 *
 * Keyed by CONVERSATION id. Surfaces without a conversation of their own
 * (the assistant popup) key by courseId as a fallback.
 */

import { create } from 'zustand'

export interface PendingChatPrompt {
  conversationId: string
  prompt: string
  /** Monotonic nonce so identical prompts still retrigger. */
  nonce: number
}

interface ChatPromptState {
  pending: PendingChatPrompt | null
  request: (conversationId: string, prompt: string) => void
  consume: (conversationId: string) => string | null
}

let promptNonce = 0

export const useChatPromptStore = create<ChatPromptState>()((set, get) => ({
  pending: null,
  request: (conversationId, prompt) => {
    promptNonce += 1
    set({ pending: { conversationId, prompt, nonce: promptNonce } })
  },
  consume: (conversationId) => {
    const pending = get().pending
    if (pending === null || pending.conversationId !== conversationId) {
      return null
    }
    set({ pending: null })
    return pending.prompt
  }
}))

/** Imperative entry point for other features (annotations, board, …). */
export function requestChatPrompt(conversationId: string, prompt: string): void {
  useChatPromptStore.getState().request(conversationId, prompt)
}
