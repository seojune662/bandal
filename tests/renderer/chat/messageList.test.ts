import { describe, expect, test } from 'vitest'
import type { MessageView } from '../../../src/renderer/src/features/chat/chatModel'
import { areMessageViewsEqual } from '../../../src/renderer/src/features/chat/MessageList'

describe('message render memoization', () => {
  test('uses id and immutable block content to identify unchanged messages', () => {
    const message: MessageView = {
      id: 'assistant-1',
      role: 'assistant',
      blocks: [
        { kind: 'text', id: 'text-1', text: '완료된 답변', streaming: false }
      ],
      streaming: false,
      interrupted: false
    }

    expect(areMessageViewsEqual(message, message)).toBe(true)
    expect(
      areMessageViewsEqual(message, { ...message, blocks: [...message.blocks] })
    ).toBe(true)
    expect(
      areMessageViewsEqual(message, {
        ...message,
        blocks: [
          { kind: 'text', id: 'text-1', text: '변경된 답변', streaming: false }
        ]
      })
    ).toBe(false)
    expect(areMessageViewsEqual(message, { ...message, id: 'assistant-2' })).toBe(
      false
    )
  })
})
