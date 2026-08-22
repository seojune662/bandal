import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type {
  AgentAction,
  AgentConfirmRequest
} from '../../../src/shared/types/agentTools'
import {
  AgentConfirmCard,
  AgentTurnChangesCard,
  agentActionUndoLabel,
  agentConfirmResponseLabel,
  agentConfirmScopeLabel,
  agentTurnUndoButtonLabel
} from '../../../src/renderer/src/features/chat/AgentToolCards'
import { AgentApprovalRail } from '../../../src/renderer/src/features/chat/AgentApprovalRail'

const confirmation: AgentConfirmRequest = {
  requestId: 'confirm-1',
  courseId: 'course-1',
  conversationId: 'conversation-1',
  tool: 'delete_course',
  summary: '과목 «고체역학»을 삭제할까요?',
  details: ['강의자료 3개', '노트 2개', '과제 1개가 함께 사라져요.']
}

function action(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id: 'action-1',
    courseId: 'course-1',
    turnId: 'turn-1',
    tool: 'create_course',
    targetKind: 'course',
    targetId: 'course-created',
    label: '과목 «고체역학»',
    undoable: true,
    undoneAt: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    ...overrides
  }
}

describe('assistant app-action cards', () => {
  test('renders the destructive summary and every affected detail', () => {
    const html = renderToStaticMarkup(
      <AgentConfirmCard
        request={confirmation}
        response={null}
        onRespond={() => undefined}
      />
    )

    expect(html).toContain(confirmation.summary)
    for (const detail of confirmation.details) {
      expect(html).toContain(detail)
    }
    expect(html).not.toContain('autofocus')
    expect(html).toContain('data-approval-safe-action="true"')
    expect(html).not.toContain('항상 허용')
  })

  test('keeps the resolved confirmation as an explicit badge', () => {
    const html = renderToStaticMarkup(
      <AgentConfirmCard
        request={confirmation}
        response={false}
        onRespond={() => undefined}
      />
    )

    expect(html).toContain('거부함')
    expect(html).not.toContain('>승인</button>')
  })

  test('renders access scopes only when the request offers them', () => {
    const html = renderToStaticMarkup(
      <AgentConfirmCard
        request={{
          ...confirmation,
          tool: 'browser_access',
          summary: 'https://my.snu.ac.kr에 읽기 권한을 허용할까요?',
          scopes: ['once', 'site', 'course']
        }}
        response={null}
        onRespond={() => undefined}
      />
    )

    expect(html).toContain('data-severity="quiet"')
    expect(html).toContain('>거절</button>')
    expect(html).toContain('>이번만</button>')
    expect(html).toContain('>이 사이트</button>')
    expect(html).toContain('>이 과목 전체</button>')
    expect(html).not.toContain('>승인</button>')
  })

  test('collapses a resolved site approval to its origin and status', () => {
    const html = renderToStaticMarkup(
      <AgentConfirmCard
        request={{
          ...confirmation,
          tool: 'browser_access',
          summary: 'https://my.snu.ac.kr에 읽기 권한을 허용할까요?',
          details: ['설정에서 해제할 수 있습니다.']
        }}
        response={true}
        onRespond={() => undefined}
      />
    )

    expect(html).toContain('data-resolved="true"')
    expect(html).toContain('my.snu.ac.kr')
    expect(html).toContain('허용함')
    expect(html).not.toContain('설정에서 해제할 수 있습니다.')
  })

  test('wraps visible activity in the labelled approval rail', () => {
    const html = renderToStaticMarkup(
      <AgentApprovalRail
        items={[
          {
            kind: 'confirmation',
            request: confirmation,
            response: null,
            isResponding: false,
            hasResponseError: false
          }
        ]}
        onRespondConfirm={() => undefined}
        onUndoTurn={() => undefined}
      />
    )

    expect(html).toContain('class="chat-approval-rail"')
    expect(html).toContain('aria-label="승인 요청"')
  })

  test('does not render an empty approval rail', () => {
    const html = renderToStaticMarkup(
      <AgentApprovalRail
        items={[]}
        onRespondConfirm={() => undefined}
        onUndoTurn={() => undefined}
      />
    )

    expect(html).toBe('')
  })

  test('marks irreversible actions without pretending they can be undone', () => {
    const irreversible = action({
      id: 'action-delete',
      tool: 'delete_course',
      label: '과목 «고체역학» 삭제',
      undoable: false
    })
    const html = renderToStaticMarkup(
      <AgentTurnChangesCard
        changes={{ turnId: 'turn-1', actions: [irreversible] }}
        onUndo={() => undefined}
      />
    )

    expect(html).toContain(irreversible.label)
    expect(html).toContain('되돌릴 수 없음')
    expect(html).toContain('되돌릴 항목 없음')
  })

  test('renders no change card for an empty action list', () => {
    const html = renderToStaticMarkup(
      <AgentTurnChangesCard
        changes={{ turnId: 'turn-empty', actions: [] }}
        onUndo={() => undefined}
      />
    )

    expect(html).toBe('')
  })

  test('exports deterministic status copy helpers', () => {
    expect(agentConfirmResponseLabel(true)).toBe('승인함')
    expect(agentConfirmResponseLabel(false)).toBe('거부함')
    expect(agentConfirmScopeLabel('once')).toBe('이번만')
    expect(agentConfirmScopeLabel('site')).toBe('이 사이트')
    expect(agentConfirmScopeLabel('course')).toBe('이 과목 전체')
    expect(agentActionUndoLabel(action({ undoable: false }))).toBe(
      '되돌릴 수 없음'
    )
    expect(
      agentActionUndoLabel(
        action({ undoneAt: '2026-08-11T01:00:00.000Z' })
      )
    ).toBe('되돌림')
    expect(agentTurnUndoButtonLabel([action()], 'idle')).toBe('되돌리기')
    expect(agentTurnUndoButtonLabel([action()], 'pending')).toBe(
      '되돌리는 중…'
    )
  })
})
