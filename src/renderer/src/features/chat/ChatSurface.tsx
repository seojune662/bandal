import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { AgentProvider } from '../../../../shared/types/agent-events'
import type { ChatAttachment } from '../../../../shared/types/chat'
import { Icon } from '../../app/icons'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { useChatPromptStore } from './chatPromptBus'
import { Composer, type ComposerHandle } from './Composer'
import { ConversationListMenu } from './ConversationListMenu'
import { formatCost, MessageList, UsageText } from './MessageList'
import { useChatSession } from './useChatSession'
import {
  AgentApprovalRail,
  hasVisibleAgentToolActivity
} from './AgentApprovalRail'
import { useAgentToolActivity } from './agentToolActivityStore'
import {
  AgentSetupCard,
  GateCard,
  ProviderSelector
} from './AgentSetupCards'
import './chat.css'
import './chat-blocks.css'
import './agent-setup.css'
import './conversation-list.css'
import { BandalMark } from '../../components/BandalMark'

const SCROLL_PIN_THRESHOLD_PX = 48

const STARTER_PROMPTS = [
  '이번 주 강의자료를 요약해줘',
  '내 필기에서 빠진 개념이 있는지 봐줘',
  '시험에 나올 만한 핵심 내용을 뽑아줘'
]

export interface ChatSurfaceProps {
  courseId: string
  /** Conversation id; surfaces without one (popup) fall back to courseId. */
  conversationId?: string
  variant?: 'tab' | 'popup'
}

function EmptyState({
  onPick
}: {
  onPick: (prompt: string) => void
}): JSX.Element {
  return (
    <div className="chat-empty">
      <BandalMark size={56} className="chat-empty__moon" />
      <h2 className="chat-empty__title">
        이 과목에 대해 무엇이든 물어보세요
      </h2>
      <p className="chat-empty__desc">강의자료를 읽고 필기도 도와줘요.</p>
      <div className="chat-empty__chips">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="chat-empty__chip"
            onClick={() => onPick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ChatSurface({
  courseId,
  conversationId,
  variant = 'tab'
}: ChatSurfaceProps): JSX.Element {
  const conversationKey = conversationId ?? courseId
  const session = useChatSession(courseId, conversationKey)
  const agentToolActivity = useAgentToolActivity(conversationKey)
  const openTab = useWorkspaceStore((store) => store.openTab)
  const [draft, setDraft] = useState('')
  const composerRef = useRef<ComposerHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isPinnedRef = useRef(true)

  const { state, phase, provider, availability, models } = session
  const pendingPrompt = useChatPromptStore((store) => store.pending)
  const consumePrompt = useChatPromptStore((store) => store.consume)

  useEffect(() => {
    if (
      pendingPrompt === null ||
      pendingPrompt.conversationId !== conversationKey
    ) {
      return
    }
    const prompt = consumePrompt(conversationKey)
    if (prompt !== null) {
      setDraft(prompt)
      composerRef.current?.focus()
    }
  }, [pendingPrompt, consumePrompt, conversationKey])

  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null && isPinnedRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [state.messages, agentToolActivity.items])

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (scroller === null) {
      return
    }
    const distance =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    isPinnedRef.current = distance < SCROLL_PIN_THRESHOLD_PX
  }, [])

  const handleSend = useCallback(
    (attachments: ChatAttachment[]) => {
      const text = draft.trim()
      if (text === '' && attachments.length === 0) {
        return
      }
      setDraft('')
      isPinnedRef.current = true
      session.send(text, attachments)
    },
    [draft, session.send]
  )

  const handlePickStarter = useCallback((prompt: string) => {
    setDraft(prompt)
    composerRef.current?.focus()
  }, [])

  const handleOpenConversation = useCallback(
    (nextConversationId: string) => {
      openTab(
        descriptorFor('chat', {
          courseId,
          conversationId: nextConversationId
        })
      )
    },
    [courseId, openTab]
  )

  const handleNewConversation = useCallback(() => {
    handleOpenConversation(crypto.randomUUID())
  }, [handleOpenConversation])

  const handleProviderChange = useCallback(
    (nextProvider: AgentProvider) => {
      const result = session.setProvider(nextProvider)
      if (result.needsNewConversation) {
        handleNewConversation()
      }
    },
    [handleNewConversation, session.setProvider]
  )

  const root = (children: ReactNode): JSX.Element => (
    <div className="chat-tab" data-variant={variant} data-tour="assistant-panel">
      {children}
    </div>
  )

  if (phase === 'loading') {
    return root(
      <div className="chat-loading" role="status" aria-label="불러오는 중">
        <BandalMark size={56} className="chat-loading__moon" />
      </div>
    )
  }

  if (phase === 'error') {
    return root(
      <GateCard
        eyebrow="ERROR"
        title="채팅을 열지 못했어요"
        onRefresh={session.refresh}
      >
        <p className="chat-gate__desc">{session.openError}</p>
      </GateCard>
    )
  }

  if (
    availability !== null &&
    (availability.code === 'version-too-old' ||
      !availability.installed ||
      !availability.loggedIn)
  ) {
    return root(
      <AgentSetupCard
        provider={provider}
        availability={availability}
        onProviderChange={handleProviderChange}
        onRefresh={session.refresh}
      />
    )
  }

  const hasAgentToolCards = hasVisibleAgentToolActivity(
    agentToolActivity.items
  )
  const isEmpty = state.messages.length === 0 && !hasAgentToolCards
  const defaultModel = models.find((model) => model.isDefault) ?? models[0]
  const selectedModel = state.model ?? defaultModel?.id ?? ''
  const includesSelected = models.some((model) => model.id === selectedModel)
  const hasSessionUsage =
    state.sessionUsage.inputTokens > 0 ||
    state.sessionUsage.outputTokens > 0 ||
    (state.sessionUsage.cacheReadTokens ?? 0) > 0 ||
    (state.sessionUsage.cacheCreationTokens ?? 0) > 0 ||
    state.sessionCostUsd > 0
  const sessionUsageTitle = [
    `입력 ${state.sessionUsage.inputTokens.toLocaleString('en-US')} tokens`,
    `출력 ${state.sessionUsage.outputTokens.toLocaleString('en-US')} tokens`,
    state.sessionUsage.cacheReadTokens === undefined
      ? null
      : `캐시 읽기 ${state.sessionUsage.cacheReadTokens.toLocaleString('en-US')} tokens`,
    state.sessionUsage.cacheCreationTokens === undefined
      ? null
      : `캐시 생성 ${state.sessionUsage.cacheCreationTokens.toLocaleString('en-US')} tokens`,
    state.sessionCostUsd > 0 ? `비용 ${formatCost(state.sessionCostUsd)}` : null
  ]
    .filter((item): item is string => item !== null)
    .join(' · ')

  return root(
    <>
      <header className="chat-header">
        {variant === 'tab' && (
          <ConversationListMenu
            courseId={courseId}
            currentConversationId={conversationKey}
            onNewConversation={handleNewConversation}
            onOpenConversation={handleOpenConversation}
          />
        )}
        {hasSessionUsage && (
          <div className="chat-session-usage" title={sessionUsageTitle}>
            <span className="chat-session-usage__label">오늘 이 대화:</span>
            <UsageText usage={state.sessionUsage} />
            {state.sessionCostUsd > 0 && (
              <span>· {formatCost(state.sessionCostUsd)}</span>
            )}
          </div>
        )}
        <ProviderSelector
          compact
          provider={provider}
          onChange={handleProviderChange}
          disabled={state.streaming}
        />
        <label className="chat-model">
          <span className="chat-model__label">모델</span>
          <select
            className="chat-model__select"
            aria-label="AI 모델 선택"
            value={selectedModel}
            disabled={state.streaming || models.length === 0}
            onChange={(event) => session.setModel(event.target.value)}
          >
            {!includesSelected && selectedModel !== '' && (
              <option value={selectedModel}>{selectedModel}</option>
            )}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
      </header>
      {state.notice !== null && state.notice.code !== 'version-too-old' && (
        <div
          className="chat-banner chat-banner--error"
          role={state.notice.fatal ? 'alert' : 'status'}
        >
          <span>{state.notice.message}</span>
          <button
            type="button"
            className="chat-banner__dismiss"
            aria-label="알림 닫기"
            onClick={session.dismissNotice}
          >
            <Icon name="x" />
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="chat-scroll"
        data-has-approval-rail={hasAgentToolCards || undefined}
        onScroll={handleScroll}
      >
        {isEmpty ? (
          <EmptyState onPick={handlePickStarter} />
        ) : (
          <>
            {/* Rail first: the grid places children in source order, so this
                is what puts it in the narrow LEFT column — and it keeps DOM
                order equal to visual order for keyboard and screen readers. */}
            <AgentApprovalRail
              items={agentToolActivity.items}
              onRespondConfirm={agentToolActivity.respondConfirm}
              onUndoTurn={agentToolActivity.undoTurn}
            />
            <MessageList
              messages={state.messages}
              pendingPermissionId={state.pendingPermissionId}
              onRespondPermission={session.respondPermission}
            />
          </>
        )}
      </div>
      <Composer
        ref={composerRef}
        courseId={courseId}
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onCancel={session.cancel}
        isStreaming={state.streaming}
        isWaitingPermission={state.pendingPermissionId !== null}
        limit={state.limit}
        disabled={false}
      />
    </>
  )
}
