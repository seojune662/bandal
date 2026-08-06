/**
 * Ordered message stream: user bubbles on the right, assistant turns as
 * full-width block sequences (text / thinking / tool / permission) with the
 * half-moon avatar, 중단됨 treatment and a subtle usage footnote per turn.
 */

import type { PermissionResponse } from '../../../../shared/types/agent-events'
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

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(costUsd < 0.1 ? 4 : 2)}`
}

function BlockRenderer({
  block,
  pendingPermissionId,
  onRespondPermission
}: {
  block: BlockView
  pendingPermissionId: string | null
  onRespondPermission: (requestId: string, response: PermissionResponse) => void
}): JSX.Element | null {
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
}

function UserMessage({ message }: { message: MessageView }): JSX.Element {
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
}

function AssistantMessage({
  message,
  pendingPermissionId,
  onRespondPermission
}: {
  message: MessageView
  pendingPermissionId: string | null
  onRespondPermission: (requestId: string, response: PermissionResponse) => void
}): JSX.Element {
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
          (stats.durationMs !== undefined || stats.costUsd !== undefined) && (
            <footer className="chat-msg__stats">
              {stats.durationMs !== undefined && (
                <span>{formatDuration(stats.durationMs)}</span>
              )}
              {stats.costUsd !== undefined && (
                <span>{formatCost(stats.costUsd)}</span>
              )}
            </footer>
          )}
      </div>
    </article>
  )
}

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
