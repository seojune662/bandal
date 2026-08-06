import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { ChatAttachment } from '../../../../shared/types/chat'
import { Icon } from '../../app/icons'
import { useChatPromptStore } from './chatPromptBus'
import { Composer, type ComposerHandle } from './Composer'
import { MessageList } from './MessageList'
import { useChatSession } from './useChatSession'
import {
  GateCard,
  InstallCard,
  LoginCard,
  ProviderSelector,
  providerLabel
} from './AgentSetupCards'
import './chat.css'
import './chat-blocks.css'
import './agent-setup.css'
import { BandalMark } from '../../components/BandalMark'

const MIN_CLI = { major: 2, minor: 1 }
const SCROLL_PIN_THRESHOLD_PX = 48

const STARTER_PROMPTS = [
  '이번 주 강의자료를 요약해줘',
  '내 필기에서 빠진 개념이 있는지 봐줘',
  '시험에 나올 만한 핵심 내용을 뽑아줘'
]

export interface ChatSurfaceProps {
  courseId: string
  variant?: 'tab' | 'popup'
}

function isCliVersionSupported(version: string | undefined): boolean {
  if (version === undefined) {
    return true
  }
  const match = /^(\d+)\.(\d+)/.exec(version)
  if (match === null) {
    return true
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major !== MIN_CLI.major) {
    return major > MIN_CLI.major
  }
  return minor >= MIN_CLI.minor
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
  variant = 'tab'
}: ChatSurfaceProps): JSX.Element {
  const session = useChatSession(courseId)
  const [draft, setDraft] = useState('')
  const composerRef = useRef<ComposerHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isPinnedRef = useRef(true)

  const { state, phase, provider, availability, models } = session
  const pendingPrompt = useChatPromptStore((store) => store.pending)
  const consumePrompt = useChatPromptStore((store) => store.consume)

  useEffect(() => {
    if (pendingPrompt === null || pendingPrompt.courseId !== courseId) {
      return
    }
    const prompt = consumePrompt(courseId)
    if (prompt !== null) {
      setDraft(prompt)
      composerRef.current?.focus()
    }
  }, [pendingPrompt, consumePrompt, courseId])

  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null && isPinnedRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [state.messages])

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

  const root = (children: ReactNode): JSX.Element => (
    <div className="chat-tab" data-variant={variant}>
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

  if (availability !== null && !availability.installed) {
    return root(
      <InstallCard
        provider={provider}
        onProviderChange={session.setProvider}
        onRefresh={session.refresh}
      />
    )
  }

  if (availability !== null && !availability.loggedIn) {
    return root(
      <LoginCard
        provider={provider}
        onProviderChange={session.setProvider}
        onRefresh={session.refresh}
      />
    )
  }

  const isVersionTooOld =
    provider === 'claude-code' &&
    (state.notice?.code === 'version-too-old' ||
      !isCliVersionSupported(availability?.version))
  const isEmpty = state.messages.length === 0
  const defaultModel = models.find((model) => model.isDefault) ?? models[0]
  const selectedModel = state.model ?? defaultModel?.id ?? ''
  const includesSelected = models.some((model) => model.id === selectedModel)

  return root(
    <>
      <header className="chat-header">
        <ProviderSelector
          compact
          provider={provider}
          onChange={session.setProvider}
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
      {isVersionTooOld && (
        <div className="chat-banner" role="status">
          {providerLabel(provider)} 버전이 오래됐어요 ({availability?.version ?? '알 수 없음'})
          {' — '}
          {MIN_CLI.major}.{MIN_CLI.minor} 이상으로 업데이트해 주세요.
        </div>
      )}
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
      <div ref={scrollRef} className="chat-scroll" onScroll={handleScroll}>
        {isEmpty ? (
          <EmptyState onPick={handlePickStarter} />
        ) : (
          <MessageList
            messages={state.messages}
            pendingPermissionId={state.pendingPermissionId}
            onRespondPermission={session.respondPermission}
          />
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
