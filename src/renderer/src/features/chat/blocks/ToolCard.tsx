/**
 * Tool call card: friendly Korean title (파일 읽는 중 / 검색 중 / 필기 수정 중…),
 * status indicator, and an expandable detail section. Edit/Write inputs get a
 * simple before/after diff-ish view; everything else shows pretty JSON plus
 * the truncated result preview.
 */

import { useState } from 'react'
import { Icon } from '../../../app/icons'
import type { ToolBlockView } from '../chatModel'
import { presentTool, prettyInput, toolChange } from '../toolPresentation'

function StatusIcon({ status }: { status: ToolBlockView['status'] }): JSX.Element {
  if (status === 'running') {
    return <span className="chat-tool__spinner" aria-label="실행 중" />
  }
  if (status === 'ok') {
    return (
      <span className="chat-tool__status chat-tool__status--ok" aria-label="완료">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M3.5 8.5 6.5 11.5 12.5 4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  return (
    <span
      className="chat-tool__status chat-tool__status--error"
      aria-label="실패"
    >
      <Icon name="x" />
    </span>
  )
}

function ChangeView({ block }: { block: ToolBlockView }): JSX.Element | null {
  const change = toolChange(block)
  if (change === null) {
    return null
  }
  return (
    <div className="chat-tool__diff">
      {change.path !== null && (
        <div className="chat-tool__diff-path">{change.path}</div>
      )}
      {change.before !== '' && (
        <pre className="chat-tool__diff-pane chat-tool__diff-pane--before">
          {change.before}
        </pre>
      )}
      <pre className="chat-tool__diff-pane chat-tool__diff-pane--after">
        {change.after}
      </pre>
    </div>
  )
}

export interface ToolCardProps {
  block: ToolBlockView
}

export function ToolCard({ block }: ToolCardProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const presentation = presentTool(block)
  const change = toolChange(block)
  const inputJson = change === null ? prettyInput(block.input) : ''
  const hasDetails =
    change !== null || inputJson !== '' || block.result?.preview !== undefined

  return (
    <div
      className="chat-tool"
      data-status={block.status}
      data-expanded={isExpanded || undefined}
    >
      <button
        type="button"
        className="chat-tool__row"
        disabled={!hasDetails}
        aria-expanded={hasDetails ? isExpanded : undefined}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <StatusIcon status={block.status} />
        <span className="chat-tool__title">{presentation.title}</span>
        {presentation.detail !== null && (
          <span className="chat-tool__detail">{presentation.detail}</span>
        )}
        {block.result !== undefined && (
          <span className="chat-tool__summary">{block.result.summary}</span>
        )}
        {hasDetails && (
          <span className="chat-tool__chevron" aria-hidden="true">
            <Icon name="chevronRight" />
          </span>
        )}
      </button>
      {isExpanded && hasDetails && (
        <div className="chat-tool__body">
          <ChangeView block={block} />
          {inputJson !== '' && (
            <pre className="chat-tool__input">{inputJson}</pre>
          )}
          {block.result?.preview !== undefined && (
            <pre className="chat-tool__result">
              {block.result.preview}
              {block.result.truncated === true ? '\n…' : ''}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
