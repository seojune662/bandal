/**
 * AI tutor chat tab — drop-in dockview panel (params.descriptor with
 * kind 'chat', payload { courseId }).
 *
 * Availability gates first (설치 안내 → 로그인 안내 → 버전 배너), then the
 * conversation: MessageList + inline permission cards + composer. Streaming
 * state, seq-gap rehydration and local echo live in useChatSession.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { useChatPromptStore } from './chatPromptBus'
import { Composer, type ComposerHandle } from './Composer'
import { MessageList } from './MessageList'
import { useChatSession } from './useChatSession'
import './chat.css'
import './chat-blocks.css'

const INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'
const MIN_CLI = { major: 2, minor: 1 }
const SCROLL_PIN_THRESHOLD_PX = 48

const STARTER_PROMPTS = [
  '이번 주 강의자료를 요약해줘',
  '내 필기에서 빠진 개념이 있는지 봐줘',
  '시험에 나올 만한 핵심 내용을 뽑아줘'
]

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

function descriptorFromParams(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) {
    return null
  }
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

// -- gate cards ---------------------------------------------------------------

function GateCard({
  eyebrow,
  title,
  children,
  onRefresh
}: {
  eyebrow: string
  title: string
  children: ReactNode
  onRefresh: () => void
}): JSX.Element {
  return (
    <div className="chat-gate">
      <div className="chat-gate__card">
        <span className="chat-gate__moon" aria-hidden="true" />
        <p className="chat-gate__eyebrow">{eyebrow}</p>
        <h2 className="chat-gate__title">{title}</h2>
        {children}
        <button type="button" className="chat-gate__refresh" onClick={onRefresh}>
          <Icon name="refresh" />
          재확인
        </button>
      </div>
    </div>
  )
}

function InstallCard({ onRefresh }: { onRefresh: () => void }): JSX.Element {
  const [isCopied, setIsCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(INSTALL_COMMAND).then(() => {
      setIsCopied(true)
      window.setTimeout(() => setIsCopied(false), 1600)
    })
  }, [])
  return (
    <GateCard
      eyebrow="SETUP"
      title="Claude Code 설치가 필요해요"
      onRefresh={onRefresh}
    >
      <p className="chat-gate__desc">
        AI 튜터는 내 컴퓨터의 Claude Code CLI로 동작해요. 터미널에서 아래
        명령어로 설치한 뒤 재확인을 눌러주세요.
      </p>
      <div className="chat-gate__command">
        <code>{INSTALL_COMMAND}</code>
        <button
          type="button"
          className="chat-gate__copy"
          onClick={copy}
          aria-label="설치 명령어 복사"
        >
          {isCopied ? '복사됨' : '복사'}
        </button>
      </div>
    </GateCard>
  )
}

function LoginCard({ onRefresh }: { onRefresh: () => void }): JSX.Element {
  return (
    <GateCard
      eyebrow="SETUP"
      title="Claude 로그인이 필요해요"
      onRefresh={onRefresh}
    >
      <p className="chat-gate__desc">
        터미널에서 <code className="chat-gate__inline-code">claude</code>를
        실행해 로그인한 뒤 재확인을 눌러주세요.
      </p>
    </GateCard>
  )
}

// -- empty state --------------------------------------------------------------

function EmptyState({
  onPick
}: {
  onPick: (prompt: string) => void
}): JSX.Element {
  return (
    <div className="chat-empty">
      <span className="chat-empty__moon" aria-hidden="true" />
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

// -- panel --------------------------------------------------------------------

function ChatSurface({ courseId }: { courseId: string }): JSX.Element {
  const session = useChatSession(courseId)
  const [draft, setDraft] = useState('')
  const composerRef = useRef<ComposerHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isPinnedRef = useRef(true)

  const { state, phase, availability } = session
  const pendingPrompt = useChatPromptStore((store) => store.pending)
  const consumePrompt = useChatPromptStore((store) => store.consume)

  // M5 hook: annotation → chat prompt prefill.
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

  // Stick to the bottom while the user hasn't scrolled away.
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

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (text === '') {
      return
    }
    setDraft('')
    isPinnedRef.current = true
    session.send(text)
  }, [draft, session])

  const handlePickStarter = useCallback((prompt: string) => {
    setDraft(prompt)
    composerRef.current?.focus()
  }, [])

  if (phase === 'loading') {
    return (
      <div className="chat-tab">
        <div className="chat-loading" role="status" aria-label="불러오는 중">
          <span className="chat-loading__moon" />
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="chat-tab">
        <GateCard
          eyebrow="ERROR"
          title="채팅을 열지 못했어요"
          onRefresh={session.refresh}
        >
          <p className="chat-gate__desc">{session.openError}</p>
        </GateCard>
      </div>
    )
  }

  if (availability !== null && !availability.installed) {
    return (
      <div className="chat-tab">
        <InstallCard onRefresh={session.refresh} />
      </div>
    )
  }

  if (availability !== null && !availability.loggedIn) {
    return (
      <div className="chat-tab">
        <LoginCard onRefresh={session.refresh} />
      </div>
    )
  }

  const isVersionTooOld =
    state.notice?.code === 'version-too-old' ||
    !isCliVersionSupported(availability?.version)
  const isEmpty = state.messages.length === 0

  return (
    <div className="chat-tab">
      {isVersionTooOld && (
        <div className="chat-banner" role="status">
          Claude Code 버전이 오래됐어요 (
          {availability?.version ?? '알 수 없음'}) —{' '}
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
      <div
        ref={scrollRef}
        className="chat-scroll"
        onScroll={handleScroll}
      >
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
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onCancel={session.cancel}
        isStreaming={state.streaming}
        isWaitingPermission={state.pendingPermissionId !== null}
        limit={state.limit}
        disabled={false}
      />
    </div>
  )
}

export default function ChatTab(props: IDockviewPanelProps): JSX.Element {
  const descriptor = descriptorFromParams(props.params)
  if (descriptor === null || descriptor.kind !== 'chat') {
    return <div className="chat-tab" data-kind="unknown" />
  }
  return <ChatSurface courseId={descriptor.payload.courseId} />
}
