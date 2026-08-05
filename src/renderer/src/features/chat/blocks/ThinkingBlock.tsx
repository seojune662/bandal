/**
 * Collapsed-by-default thinking block: a quiet "생각 중…" row with pulsing
 * dots while streaming, expandable to the raw reasoning text afterwards.
 */

import { useState } from 'react'
import { Icon } from '../../../app/icons'
import type { ThinkingBlockView } from '../chatModel'

export interface ThinkingBlockProps {
  block: ThinkingBlockView
}

export function ThinkingBlock({ block }: ThinkingBlockProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div
      className="chat-thinking"
      data-streaming={block.streaming || undefined}
      data-expanded={isExpanded || undefined}
    >
      <button
        type="button"
        className="chat-thinking__toggle"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className="chat-thinking__chevron" aria-hidden="true">
          <Icon name="chevronRight" />
        </span>
        <span className="chat-thinking__label">
          {block.streaming ? '생각 중' : '생각'}
        </span>
        {block.streaming && (
          <span className="chat-thinking__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      {isExpanded && block.text !== '' && (
        <div className="chat-thinking__body">{block.text}</div>
      )}
    </div>
  )
}
