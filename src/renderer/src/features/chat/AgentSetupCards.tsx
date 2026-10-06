import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  AGENT_PROVIDERS,
  isAgentProvider,
  type AgentAvailability,
  type AgentProvider
} from '../../../../shared/types/agent-events'
import { BandalMark } from '../../components/BandalMark'
import { Icon } from '../../app/icons'
import {
  acquireAgentConnection, isAgentConnectionBusy, isAgentConnectionReady, prepareAgentConnection,
  refreshAgentConnection, seedAgentAvailability, startAgentInstall, startAgentLogin, useAgentConnectionStore
} from './agentConnectionStore'

const PROVIDER_LABELS: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex (GPT)',
  gemini: 'Gemini'
}

export function providerLabel(provider: AgentProvider): string {
  return PROVIDER_LABELS[provider]
}

export function ProviderSelector({
  provider,
  onChange,
  disabled = false,
  compact = false
}: {
  provider: AgentProvider
  onChange: (provider: AgentProvider) => void
  disabled?: boolean
  compact?: boolean
}): JSX.Element {
  if (compact) {
    return (
      <label className="chat-provider-select">
        <span>AI 제공자</span>
        <select
          aria-label="AI 제공자 선택"
          value={provider}
          disabled={disabled}
          onChange={(event) => {
            const nextProvider = event.currentTarget.value
            if (isAgentProvider(nextProvider)) onChange(nextProvider)
          }}
        >
          {AGENT_PROVIDERS.map((option) => (
            <option key={option} value={option}>
              {PROVIDER_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <fieldset className="chat-provider" disabled={disabled}>
      <legend>AI 제공자 선택</legend>
      <div className="chat-provider__options">
        {AGENT_PROVIDERS.map((option) => (
          <label
            key={option}
            className="chat-provider__option"
            data-selected={provider === option}
          >
            <input
              type="radio"
              name="chat-agent-provider"
              value={option}
              checked={provider === option}
              onChange={() => onChange(option)}
            />
            <span>{PROVIDER_LABELS[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function GateCard({
  eyebrow,
  title,
  children,
  onRefresh
}: {
  eyebrow: string
  title: string
  children: ReactNode
  onRefresh?: () => void
}): JSX.Element {
  return (
    <div className="chat-gate">
      <div className="chat-gate__card">
        <BandalMark size={36} className="chat-gate__moon" />
        <p className="chat-gate__eyebrow">{eyebrow}</p>
        <h2 className="chat-gate__title">{title}</h2>
        {children}
        {onRefresh !== undefined && (
          <button
            type="button"
            className="chat-gate__refresh"
            onClick={onRefresh}
          >
            <Icon name="refresh" />
            재확인
          </button>
        )}
      </div>
    </div>
  )
}

function commandFromLoginFailure(message: string): string {
  const match = /직접 실행해 주세요:\s*(.+)$/u.exec(message)
  return match?.[1]?.trim() || message
}

export function AgentSetupCard({
  provider,
  availability,
  onProviderChange,
  onRefresh
}: {
  provider: AgentProvider
  availability: AgentAvailability
  onProviderChange: (provider: AgentProvider) => void
  onRefresh: () => void
}): JSX.Element {
  const connection = useAgentConnectionStore(state => state.connections[provider])
  const { stage, command, logs, message, loginFailure } = connection
  const [copied, setCopied] = useState(false)
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh
  const confirmedReadyRef = useRef(false)
  const currentAvailability = connection.availability ?? availability
  const needsUpdate = currentAvailability.code === 'version-too-old'
  const needsInstall = !currentAvailability.installed || needsUpdate
  const busy = isAgentConnectionBusy(stage)

  useEffect(() => {
    seedAgentAvailability(provider, availability)
  }, [provider, availability])
  useEffect(() => {
    confirmedReadyRef.current = false
    return acquireAgentConnection(provider)
  }, [provider])
  useEffect(() => {
    if (needsInstall) void prepareAgentConnection(provider).catch(() => undefined)
  }, [needsInstall, provider])
  useEffect(() => {
    if (!isAgentConnectionReady(useAgentConnectionStore.getState().connections[provider].availability) || confirmedReadyRef.current) return
    confirmedReadyRef.current = true
    refreshRef.current()
  }, [connection.availability, provider])
  const install = useCallback(() => { void startAgentInstall(provider) }, [provider])
  const openLogin = useCallback(() => { void startAgentLogin(provider) }, [provider])

  const copyLoginCommand = useCallback(() => {
    void navigator.clipboard
      .writeText(commandFromLoginFailure(loginFailure))
      .then(() => setCopied(true), () => setCopied(false))
  }, [loginFailure])

  const title = needsUpdate
    ? '업데이트가 필요해요'
    : needsInstall
      ? `${providerLabel(provider)} 연결이 필요해요`
      : `${providerLabel(provider)} 로그인이 필요해요`
  const actionLabel = needsUpdate
    ? stage === 'installing'
      ? '업데이트 중…'
      : stage === 'checking-install'
        ? '업데이트 확인 중…'
        : '업데이트하기'
    : needsInstall
      ? stage === 'installing'
        ? '연결 중…'
        : stage === 'checking-install'
          ? '설치 확인 중…'
          : '연결하기'
      : stage === 'opening-login'
        ? '로그인 창 여는 중…'
        : '로그인 창 열기'

  return (
    <GateCard eyebrow="SETUP" title={title} onRefresh={() => { void refreshAgentConnection(provider, true) }}>
      <ProviderSelector
        provider={provider}
        onChange={onProviderChange}
        disabled={busy}
      />

      {needsUpdate ? (
        <p className="chat-gate__desc">
          현재 버전 {currentAvailability.version ?? '알 수 없음'}을 최신 버전으로
          업데이트하면 자동으로 연결을 이어갈게요.
        </p>
      ) : needsInstall ? (
        <p className="chat-gate__desc">
          연결하기를 누르면 {providerLabel(provider)} CLI를 설치하고 로그인까지
          이어서 도와드려요.
        </p>
      ) : (
        <p className="chat-gate__desc">
          로그인 창을 열고 터미널의 안내를 마치면 이 화면이 자동으로 넘어가요.
        </p>
      )}

      <button
        type="button"
        className="chat-gate__primary"
        disabled={busy}
        onClick={needsInstall ? install : openLogin}
      >
        {actionLabel}
      </button>

      {needsInstall && command !== '' && (
        <details className="chat-gate__command">
          <summary>설치 명령어 보기</summary>
          <code>{command}</code>
        </details>
      )}

      {stage === 'installing' && (
        <p className="chat-gate__notice" role="status">
          설치 중이에요. 시작한 설치는 취소할 수 없으며 최대 5분 뒤 자동으로
          중단돼요.
        </p>
      )}

      {logs.length > 0 && (
        <pre className="chat-gate__logs" aria-live="polite">
          {logs.join('\n')}
        </pre>
      )}

      {message !== '' && (
        <p
          className="chat-gate__notice"
          role={stage === 'error' ? 'alert' : 'status'}
          data-error={stage === 'error'}
        >
          {message}
        </p>
      )}

      {loginFailure !== '' && (
        <div className="chat-gate__command" role="alert">
          <code>{loginFailure}</code>
          <button
            type="button"
            className="chat-gate__copy"
            onClick={copyLoginCommand}
          >
            {copied ? '복사됨' : '명령 복사'}
          </button>
        </div>
      )}

      {connection.error !== null && <p className="chat-gate__notice" role="alert">{connection.error}</p>}
      {connection.availabilityError !== null && <p className="chat-gate__notice" role="alert">{connection.availabilityError}</p>}
      {currentAvailability.reason !== undefined && currentAvailability.reason !== '' && (
        <p className="chat-gate__notice">{currentAvailability.reason}</p>
      )}
    </GateCard>
  )
}

export function LoginCard({
  provider,
  onProviderChange,
  onRefresh,
  availability = { installed: true, loggedIn: false }
}: {
  provider: AgentProvider
  onProviderChange: (provider: AgentProvider) => void
  onRefresh: () => void
  availability?: AgentAvailability
}): JSX.Element {
  return (
    <AgentSetupCard
      provider={provider}
      availability={availability}
      onProviderChange={onProviderChange}
      onRefresh={onRefresh}
    />
  )
}
