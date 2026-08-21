/**
 * Ordered message stream: user bubbles on the right, assistant turns as
 * full-width block sequences (text / thinking / tool / permission) with the
 * half-moon avatar, 중단됨 treatment and a subtle usage footnote per turn.
 */

import { memo } from 'react'
import type {
  PermissionResponse,
  Usage
} from '../../../../shared/types/agent-events'
import type { BlockView, MessageView } from './chatModel'
import { PermissionDialog } from './blocks/PermissionDialog'
import { TextBlock } from './blocks/TextBlock'
import { ThinkingBlock } from './blocks/ThinkingBlock'
import { ToolCard } from './blocks/ToolCard'

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${Math.round(durationMs)}ms`
    : `${(durationMs / 1000).toFixed(1)}초`
}

export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(costUsd < 0.1 ? 4 : 2)}`
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  }
  return Math.round(value).toLocaleString('en-US')
}

function cacheUsageTitle(usage: Usage): string | undefined {
  const cache = [
    usage.cacheReadTokens === undefined
      ? null
      : `캐시 읽기 ${usage.cacheReadTokens.toLocaleString('en-US')} tokens`,
    usage.cacheCreationTokens === undefined
      ? null
      : `캐시 생성 ${usage.cacheCreationTokens.toLocaleString('en-US')} tokens`
  ].filter((item): item is string => item !== null)
  return cache.length === 0 ? undefined : cache.join(' · ')
}

export function UsageText({ usage }: { usage: Usage }): JSX.Element {
  const cacheTitle = cacheUsageTitle(usage)
  const cacheLabel = cacheTitle === undefined ? '' : `, ${cacheTitle}`
  return (
    <span
      className="chat-usage"
      aria-label={`입력 ${usage.inputTokens.toLocaleString('en-US')} tokens, 출력 ${usage.outputTokens.toLocaleString('en-US')} tokens${cacheLabel}`}
      title={cacheTitle}
    >
      ↑{formatTokenCount(usage.inputTokens)} ↓
      {formatTokenCount(usage.outputTokens)} tokens
    </span>
  )
}

interface BlockRendererProps {
  block: BlockView
  pendingPermissionId: string | null
  onRespondPermission: (requestId: string, response: PermissionResponse) => void
}

function activePermissionForBlock(
  block: BlockView,
  pendingPermissionId: string | null
): string | null {
  return block.kind === 'permission' && block.id === pendingPermissionId
    ? block.id
    : null
}

const BlockRenderer = memo(function BlockRenderer({
  block,
  pendingPermissionId,
  onRespondPermission
}: BlockRendererProps): JSX.Element | null {
  switch (block.kind) {
    case 'text':
      return <TextBlock block={block} />
    case 'thinking':
      return <ThinkingBlock block={block} />
    case 'tool':
      return <ToolCard block={block} />
    case 'permission':
      return (
        <PermissionDialog
          block={block}
          isActive={pendingPermissionId === block.id}
          onRespond={onRespondPermission}
        />
      )
  }
}, (previous, next) =>
  previous.block === next.block &&
  previous.onRespondPermission === next.onRespondPermission &&
  activePermissionForBlock(previous.block, previous.pendingPermissionId) ===
    activePermissionForBlock(next.block, next.pendingPermissionId)
)

/** Equality for immutable message view-models: id plus their content version. */
export function areMessageViewsEqual(
  previous: MessageView,
  next: MessageView
): boolean {
  if (previous === next) return true
  if (
    previous.id !== next.id ||
    previous.role !== next.role ||
    previous.streaming !== next.streaming ||
    previous.interrupted !== next.interrupted ||
    previous.blocks.length !== next.blocks.length
  ) {
    return false
  }
  for (let index = 0; index < previous.blocks.length; index += 1) {
    if (previous.blocks[index] !== next.blocks[index]) return false
  }
  return (
    previous.stats?.durationMs === next.stats?.durationMs &&
    previous.stats?.costUsd === next.stats?.costUsd &&
    previous.stats?.usage === next.stats?.usage
  )
}

const UserMessage = memo(function UserMessage({
  message
}: {
  message: MessageView
}): JSX.Element {
  const text = message.blocks
    .map((block) => (block.kind === 'text' ? block.text : ''))
    .join('')
  const images = message.blocks.flatMap((block) =>
    block.kind === 'text' ? (block.images ?? []) : []
  )
  return (
    <article className="chat-msg chat-msg--user">
      <div className="chat-bubble">
        {images.length > 0 && (
          <div className="chat-bubble__images">
            {images.map((image, index) => (
              <img
                key={`${image.mediaType}:${index}`}
                className="chat-bubble__image"
                src={`data:${image.mediaType};base64,${image.dataBase64}`}
                alt={`첨부 이미지 ${index + 1}`}
              />
            ))}
          </div>
        )}
        {text !== '' && <span>{text}</span>}
      </div>
    </article>
  )
}, (previous, next) => areMessageViewsEqual(previous.message, next.message))

interface AssistantMessageProps {
  message: MessageView
  pendingPermissionId: string | null
  onRespondPermission: (requestId: string, response: PermissionResponse) => void
}

function activePermissionForMessage(
  message: MessageView,
  pendingPermissionId: string | null
): string | null {
  if (pendingPermissionId === null) return null
  return message.blocks.some(
    (block) => block.kind === 'permission' && block.id === pendingPermissionId
  )
    ? pendingPermissionId
    : null
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  pendingPermissionId,
  onRespondPermission
}: AssistantMessageProps): JSX.Element {
  const stats = message.stats
  return (
    <article
      className="chat-msg chat-msg--assistant"
      data-interrupted={message.interrupted || undefined}
      data-streaming={message.streaming || undefined}
    >
      <span className="chat-avatar" aria-hidden="true" />
      <div className="chat-msg__content">
        {message.blocks.map((block) => (
          <BlockRenderer
            key={`${block.kind}:${block.id}`}
            block={block}
            pendingPermissionId={pendingPermissionId}
            onRespondPermission={onRespondPermission}
          />
        ))}
        {message.interrupted && (
          <span className="chat-msg__chip">중단됨</span>
        )}
        {!message.streaming &&
          stats !== undefined &&
          (stats.durationMs !== undefined ||
            stats.costUsd !== undefined ||
            stats.usage !== undefined) && (
            <footer className="chat-msg__stats">
              {stats.durationMs !== undefined && (
                <span>{formatDuration(stats.durationMs)}</span>
              )}
              {stats.usage !== undefined && <UsageText usage={stats.usage} />}
              {stats.costUsd !== undefined && (
                <span>{formatCost(stats.costUsd)}</span>
              )}
            </footer>
          )}
      </div>
    </article>
  )
}, (previous, next) =>
  areMessageViewsEqual(previous.message, next.message) &&
  previous.onRespondPermission === next.onRespondPermission &&
  activePermissionForMessage(
    previous.message,
    previous.pendingPermissionId
  ) === activePermissionForMessage(next.message, next.pendingPermissionId)
)

export interface MessageListProps {
  messages: MessageView[]
  pendingPermissionId: string | null
  onRespondPermission: (requestId: string, response: PermissionResponse) => void
}

export function MessageList({
  messages,
  pendingPermissionId,
  onRespondPermission
}: MessageListProps): JSX.Element {
  return (
    <div className="chat-thread" role="log" aria-label="AI 튜터 대화">
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} message={message} />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            pendingPermissionId={pendingPermissionId}
            onRespondPermission={onRespondPermission}
          />
        )
      )}
    </div>
  )
}
