/**
 * Inline permission card in the message stream (not a modal): tool name,
 * input summary, and 허용 / 항상 허용 / 거부 actions. Remembered grants never
 * reach the renderer, so every card here is a genuine question.
 */

import { useEffect, useRef, useState } from 'react'
import type { PermissionResponse } from '../../../../../shared/types/agent-events'
import type { PermissionBlockView } from '../chatModel'
import { presentTool, prettyInput, summarizeInput } from '../toolPresentation'

export interface PermissionDialogProps {
  block: PermissionBlockView
  /** True when this request is the one currently blocking the turn. */
  isActive: boolean
  autoFocusReject?: boolean
  shouldAutoFocusReject?: () => boolean
  responseState?: 'pending' | 'error' | undefined
  onRespond: (requestId: string, response: PermissionResponse) => void
}

function resolvedLabel(behavior: 'allow' | 'deny' | undefined): string {
  if (behavior === 'allow') {
    return '허용함'
  }
  if (behavior === 'deny') {
    return '거부함'
  }
  return '응답하지 않음'
}

export function PermissionDialog({
  block,
  isActive,
  autoFocusReject = false,
  shouldAutoFocusReject,
  onRespond,
  responseState
}: PermissionDialogProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const rejectButtonRef = useRef<HTMLButtonElement>(null)
  const isPending = block.behavior === undefined && isActive
  const presentation = presentTool({ kind: 'tool', id: block.id, toolName: block.toolName, input: block.input, label: '', status: 'running' })
  const toolTitle = ({ Read: '파일 읽기', Write: '파일 작성', Edit: '파일 수정', Bash: '명령 실행', Grep: '파일 검색', Glob: '파일 검색', WebFetch: '웹 페이지 읽기', WebSearch: '웹 검색' } as Record<string, string>)[block.toolName] ?? block.toolName
  const summary = presentation.detail ?? (summarizeInput(block.input) ? '세부 작업 내용 보기' : '')
  const detail = prettyInput(block.input)

  useEffect(() => {
    if (
      !isPending ||
      !autoFocusReject ||
      shouldAutoFocusReject?.() === false
    ) {
      return
    }
    rejectButtonRef.current?.focus()
  }, [block.id, isPending, autoFocusReject, shouldAutoFocusReject])

  if (!isPending) {
    return (
      <div className="chat-permission chat-permission--resolved">
        <span
          className="chat-permission__badge"
          data-behavior={block.behavior ?? 'none'}
        >
          {resolvedLabel(block.behavior)}
        </span>
        <span className="chat-permission__tool" title={block.toolName}>{toolTitle}</span>
        {summary !== '' && (
          <span className="chat-permission__summary">{summary}</span>
        )}
      </div>
    )
  }

  return (
    <div className="chat-permission" role="group" aria-label="도구 실행 허용 요청">
      <div className="chat-permission__head">
        <span className="chat-permission__pulse" aria-hidden="true" />
        <strong>도구 실행 허용이 필요해요</strong>
      </div>
      <div className="chat-permission__request">
        <span className="chat-permission__tool" title={block.toolName}>{toolTitle}</span>
        {summary !== '' && (
          <button
            type="button"
            className="chat-permission__summary chat-permission__summary--toggle"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
          >
            {summary}
          </button>
        )}
      </div>
      {isExpanded && detail !== '' && (
        <pre className="chat-permission__detail">{detail}</pre>
      )}
      {responseState === 'error' && <p role="alert">응답을 보내지 못했어요. 다시 선택해 주세요.</p>}
      {responseState === 'pending' && <p role="status">응답을 보내는 중…</p>}
      <fieldset className="chat-permission__actions" disabled={responseState === 'pending'}>
        <button
          ref={rejectButtonRef}
          type="button"
          className="chat-permission__btn chat-permission__btn--deny"
          data-approval-safe-action="true"
          onClick={() => onRespond(block.id, { behavior: 'deny' })}
        >
          거부
        </button>
        <button
          type="button"
          className="chat-permission__btn chat-permission__btn--allow"
          onClick={() => onRespond(block.id, { behavior: 'allow' })}
        >
          이번만 허용
        </button>
        {block.suggestions?.some((suggestion) => suggestion.remember) && <button
          type="button"
          className="chat-permission__btn"
          onClick={() =>
            onRespond(block.id, { behavior: 'allow', remember: true })
          }
        >
          이 도구 기억하기
        </button>}
      </fieldset>
    </div>
  )
}
