import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import {
  ChatSurface,
  syncApprovalDocumentTitle
} from '../../../src/renderer/src/features/chat/ChatSurface'
import { useAgentToolActivityStore } from '../../../src/renderer/src/features/chat/agentToolActivityStore'
import { initialChatViewState } from '../../../src/renderer/src/features/chat/chatModel'
import { useChatSessionStore } from '../../../src/renderer/src/features/chat/chatSessionStore'

const conversationId = 'conversation-approval'

function seedApprovalState(resolved: boolean): void {
  useChatSessionStore.setState({
    sessions: {
      [conversationId]: {
        phase: 'ready',
        provider: 'claude-code',
        availability: null,
        openError: null,
        models: [],
        title: null,
        state: {
          ...initialChatViewState,
          streaming: !resolved,
          pendingPermissionId: resolved ? null : 'permission-v1',
          messages: [
            {
              id: 'assistant-1',
              role: 'assistant',
              streaming: !resolved,
              interrupted: false,
              blocks: [
                {
                  kind: 'permission',
                  id: 'permission-v1',
                  toolName: 'write_file',
                  input: { path: 'notes.md' },
                  ...(resolved ? { behavior: 'deny' as const } : {})
                }
              ]
            }
          ]
        }
      }
    }
  })
  useAgentToolActivityStore.setState({
    conversations: {
      [conversationId]: {
        items: [
          {
            kind: 'confirmation',
            request: {
              requestId: 'confirmation-v2',
              courseId: 'course-1',
              conversationId,
              tool: 'delete_course',
              summary: '과목을 삭제할까요?',
              details: []
            },
            response: resolved ? false : null,
            isResponding: false,
            hasResponseError: false
          }
        ]
      }
    }
  })
}

afterEach(() => {
  useChatSessionStore.setState({ sessions: {} })
  useAgentToolActivityStore.setState({ conversations: {} })
})

describe('ChatSurface approval dock', () => {
  test('renders pending v1 and v2 requests outside the scroll area above the composer', () => {
    seedApprovalState(false)

    const html = renderToStaticMarkup(
      <ChatSurface
        courseId="course-1"
        conversationId={conversationId}
        variant="popup"
      />
    )

    expect(html).toContain('class="chat-approval-dock"')
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-label="승인 요청"')
    expect(html).toContain('write_file')
    expect(html).toContain('과목을 삭제할까요?')
    expect(html.indexOf('class="chat-scroll"')).toBeLessThan(
      html.indexOf('class="chat-approval-dock"')
    )
    expect(html.indexOf('class="chat-approval-dock"')).toBeLessThan(
      html.indexOf('class="chat-composer-zone"')
    )
  })

  test('removes the dock and returns resolved cards to their history positions', () => {
    seedApprovalState(true)

    const html = renderToStaticMarkup(
      <ChatSurface courseId="course-1" conversationId={conversationId} />
    )

    expect(html).not.toContain('class="chat-approval-dock"')
    expect(html).toContain('class="chat-approval-rail"')
    expect(html).toContain('data-behavior="deny">거부함')
    expect(html).toContain('data-resolved="true"')
    expect(html).toContain('data-approved="false">거부함')
  })

  test('keeps the title marked until every pending surface resolves', () => {
    const first = Symbol('first')
    const second = Symbol('second')
    const originalDocument = globalThis.document
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { title: 'Bandal' }
    })

    try {
      syncApprovalDocumentTitle(first, true)
      syncApprovalDocumentTitle(second, true)
      expect(document.title).toBe('● Bandal')

      syncApprovalDocumentTitle(first, false)
      expect(document.title).toBe('● Bandal')

      syncApprovalDocumentTitle(second, false)
      expect(document.title).toBe('Bandal')
    } finally {
      syncApprovalDocumentTitle(first, false)
      syncApprovalDocumentTitle(second, false)
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument
      })
    }
  })
})
