import { usePanelActive } from '../workspace/usePanelActive'
import { useEffect, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor } from '../../../../shared/tabs'
import { invoke } from '../../lib/ipc'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { useHasBeenShown } from '../workspace/useHasBeenShown'
import { openWorkspaceAssistant } from '../assistantPanel/assistantController'
import { useWorkspacePlacement } from '../workspace/placementContext'
import { useChatSessionStore } from './chatSessionStore'
import { workspaceKey } from '../../../../shared/types/workspace'

function descriptorFromParams(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) {
    return null
  }
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

/**
 * Legacy persisted layouts/favorites carry no conversationId. Resolve one on
 * first display — the course's newest conversation when it has any, else a
 * fresh id — and write the normalized descriptor back into the panel params
 * so the next layout save persists it.
 */
function useResolvedConversationId(
  props: IDockviewPanelProps,
  courseId: string | null,
  fromPayload: string | undefined,
  enabled: boolean,
  scope: string | undefined
): string | null {
  const [resolved, setResolved] = useState<string | null>(fromPayload ?? null)

  useEffect(() => {
    if (fromPayload !== undefined || courseId === null) {
      setResolved(fromPayload ?? null)
      return
    }
    if (!enabled) {
      setResolved(null)
      return
    }
    let cancelled = false
    void invoke('chat:conversations', { courseId, ...(scope ? { workspaceKey: scope } : {}) })
      .then(({ conversations }) => conversations[0]?.id ?? crypto.randomUUID())
      .catch(() => crypto.randomUUID())
      .then((conversationId) => {
        if (cancelled) {
          return
        }
        props.api.updateParameters({
          descriptor: {
            kind: 'chat',
            payload: { courseId, conversationId }
          } satisfies TabDescriptor
        })
        setResolved(conversationId)
      })
    return () => {
      cancelled = true
    }
    // props.api is stable for the panel's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, enabled, fromPayload, scope])

  return resolved
}

export default function ChatTab(props: IDockviewPanelProps): JSX.Element {
  const placement = useWorkspacePlacement()
  const hasBeenShown = useHasBeenShown(props.api)
  const descriptor = descriptorFromParams(props.params)
  const active = usePanelActive(props.api)
  const isChat = descriptor !== null && descriptor.kind === 'chat'
  const courseId = isChat ? descriptor.payload.courseId : null
  const conversationId = useResolvedConversationId(
    props,
    courseId,
    isChat ? descriptor.payload.conversationId : undefined,
    hasBeenShown,
    courseId ? workspaceKey(placement?.workspace?.courseId === courseId ? placement.workspace : { kind: 'course', courseId }) : undefined
  )

  // The first message names the conversation — rename the tab to match, the
  // same async-rename trick GroupChatTab uses.
  const title = useChatSessionStore((state) =>
    conversationId === null
      ? null
      : (state.sessions[conversationId]?.title ?? null)
  )
  useEffect(() => {
    props.api.setTitle(title === null || title === '' ? 'AI 튜터' : title)
    // props.api is stable for the panel's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  if (!isChat || courseId === null) {
    return <div className="chat-tab" data-kind="unknown" />
  }
  if (!hasBeenShown) {
    return (
      <div className="chat-tab" data-kind="pending">
        <div className="chat-loading" role="status">
          AI 튜터를 준비하는 중…
        </div>
      </div>
    )
  }
  if (conversationId === null) {
    // Resolving the legacy payload — don't mount the surface against a
    // conversation that is about to change identity.
    return <div className="chat-tab" data-kind="resolving" />
  }
  return <LegacyConversationHandoff courseId={courseId} conversationId={conversationId} active={active} workspace={placement?.workspace} onClose={() => props.api.close()} />
}
function LegacyConversationHandoff({ courseId, conversationId, active, workspace, onClose }: { courseId: string; conversationId: string; active: boolean; onClose: () => void; workspace?: import('../../../../shared/types/workspace').WorkspaceRef | null | undefined }): JSX.Element {
  const open = (): void => { openWorkspaceAssistant(workspace?.courseId === courseId ? workspace : { kind: 'course', courseId }, { conversationId }) }
  useEffect(() => { if (active) { open(); onClose() } }, [active, courseId, conversationId])
  return <div className="chat-tab chat-loading"><p>이 대화는 오른쪽 AI에서 이어갈 수 있어요.</p><button type="button" onClick={open}>AI에서 대화 열기</button></div>
}
