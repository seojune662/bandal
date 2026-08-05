/**
 * Cross-feature hook for pushing a prompt into a course's chat composer —
 * e.g. M5's annotation → "이 부분 설명해줘" flow. Callers use
 * `requestChatPrompt(courseId, prompt)`; the mounted ChatTab for that course
 * consumes it, prefills the composer and focuses it.
 */

import { create } from 'zustand'

export interface PendingChatPrompt {
  courseId: string
  prompt: string
  /** Monotonic nonce so identical prompts still retrigger. */
  nonce: number
}

interface ChatPromptState {
  pending: PendingChatPrompt | null
  request: (courseId: string, prompt: string) => void
  consume: (courseId: string) => string | null
}

let promptNonce = 0

export const useChatPromptStore = create<ChatPromptState>()((set, get) => ({
  pending: null,
  request: (courseId, prompt) => {
    promptNonce += 1
    set({ pending: { courseId, prompt, nonce: promptNonce } })
  },
  consume: (courseId) => {
    const pending = get().pending
    if (pending === null || pending.courseId !== courseId) {
      return null
    }
    set({ pending: null })
    return pending.prompt
  }
}))

/** Imperative entry point for other features (annotations, board, …). */
export function requestChatPrompt(courseId: string, prompt: string): void {
  useChatPromptStore.getState().request(courseId, prompt)
}
