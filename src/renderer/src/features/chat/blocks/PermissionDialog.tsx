/**
 * Inline permission card in the message stream (not a modal): tool name,
 * input summary, and 허용 / 항상 허용 / 거부 actions. Remembered grants never
 * reach the renderer, so every card here is a genuine question.
 */

import { useState } from 'react'
import type { PermissionResponse } from '../../../../../shared/types/agent-events'
import type { PermissionBlockView } from '../chatModel'
import { prettyInput, summarizeInput } from '../toolPresentation'

export interface PermissionDialogProps {
  block: PermissionBlockView
  /** True when this request is the one currently blocking the turn. */
  isActive: boolean
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
  onRespond
}: PermissionDialogProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const isPending = block.behavior === undefined && isActive
  const summary = summarizeInput(block.input)
  const detail = prettyInput(block.input)

  if (!isPending) {
    return (
      <div className="chat-permission chat-permission--resolved">
        <span
          className="chat-permission__badge"
          data-behavior={block.behavior ?? 'none'}
        >
          {resolvedLabel(block.behavior)}
        </span>
        <span className="chat-permission__tool">{block.toolName}</span>
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
        <span className="chat-permission__tool">{block.toolName}</span>
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
      <div className="chat-permission__actions">
        <button
          type="button"
          className="chat-permission__btn chat-permission__btn--allow"
          onClick={() => onRespond(block.id, { behavior: 'allow' })}
        >
          허용
        </button>
        <button
          type="button"
          className="chat-permission__btn"
          onClick={() =>
            onRespond(block.id, { behavior: 'allow', remember: true })
          }
        >
          항상 허용
        </button>
        <button
          type="button"
          className="chat-permission__btn chat-permission__btn--deny"
          onClick={() => onRespond(block.id, { behavior: 'deny' })}
        >
          거부
        </button>
      </div>
    </div>
  )
}
