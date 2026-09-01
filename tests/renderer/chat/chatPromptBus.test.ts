import { beforeEach, describe, expect, test } from 'vitest'
import {
  formatQuoteBlock,
  requestChatPrompt,
  useChatPromptStore
} from '../../../src/renderer/src/features/chat/chatPromptBus'
import { composeOutgoingText } from '../../../src/renderer/src/features/chat/ChatSurface'

beforeEach(() => {
  useChatPromptStore.setState({ pending: null })
})

describe('chatPromptBus payloads', () => {
  test('normalizes plain strings into { text } (legacy callers untouched)', () => {
    requestChatPrompt('conv-1', '이 부분 설명해줘')
    expect(useChatPromptStore.getState().consume('conv-1')).toEqual({
      text: '이 부분 설명해줘'
    })
  })

  test('carries a quote payload through untouched', () => {
    const quote = { text: '양력은 순환에 비례한다', source: '공기역학 3쪽' }
    requestChatPrompt('conv-1', { quote })
    expect(useChatPromptStore.getState().consume('conv-1')).toEqual({ quote })
  })

  test('consume returns null for a different conversation and clears on read', () => {
    requestChatPrompt('conv-1', 'x')
    expect(useChatPromptStore.getState().consume('other')).toBeNull()
    expect(useChatPromptStore.getState().consume('conv-1')).toEqual({ text: 'x' })
    expect(useChatPromptStore.getState().consume('conv-1')).toBeNull()
  })

  test('identical prompts still retrigger via the nonce', () => {
    requestChatPrompt('conv-1', 'same')
    const first = useChatPromptStore.getState().pending?.nonce
    requestChatPrompt('conv-1', 'same')
    const second = useChatPromptStore.getState().pending?.nonce
    expect(second).not.toBe(first)
  })
})

describe('formatQuoteBlock / composeOutgoingText', () => {
  const quote = { text: '첫 줄\n둘째 줄', source: '강의  3쪽' }

  test('formats a markdown blockquote with a collapsed source line', () => {
    expect(formatQuoteBlock(quote)).toBe(
      '> 첫 줄\n> 둘째 줄\n>\n> (강의 3쪽에서)'
    )
  })

  test('composes quote-only, text-only and combined sends', () => {
    expect(composeOutgoingText('', [quote])).toBe(formatQuoteBlock(quote))
    expect(composeOutgoingText('  요약해줘  ', [])).toBe('요약해줘')
    expect(composeOutgoingText('요약해줘', [quote])).toBe(
      `${formatQuoteBlock(quote)}\n\n요약해줘`
    )
  })

  test('joins multiple quote chips with blank lines, in order', () => {
    const second = { text: '항력', source: '4쪽' }
    expect(composeOutgoingText('비교해줘', [quote, second])).toBe(
      `${formatQuoteBlock(quote)}\n\n${formatQuoteBlock(second)}\n\n비교해줘`
    )
  })
})
