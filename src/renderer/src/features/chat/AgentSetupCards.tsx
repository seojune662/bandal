import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AgentAvailability,
  AgentProvider
} from '../../../../shared/types/agent-events'
import { BandalMark } from '../../components/BandalMark'
import { Icon } from '../../app/icons'
import { invoke, onPush } from '../../lib/ipc'

const PROVIDER_LABELS: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex (GPT)'
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
          onChange={(event) => onChange(event.target.value as AgentProvider)}
        >
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex (GPT)</option>
        </select>
      </label>
    )
  }
  return (
    <fieldset className="chat-provider" disabled={disabled}>
      <legend>AI 제공자 선택</legend>
      <div className="chat-provider__options">
        {(['claude-code', 'codex'] as const).map((option) => (
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

type SetupStage =
  | 'idle'
  | 'installing'
  | 'checking-install'
  | 'opening-login'
  | 'waiting-login'
  | 'error'

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
  const [stage, setStage] = useState<SetupStage>('idle')
  const [command, setCommand] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [loginFailure, setLoginFailure] = useState('')
  const [copied, setCopied] = useState(false)
  const installStartedRef = useRef(false)
  const installFinishedRef = useRef(false)
  const continueAfterInstallRef = useRef(false)
  const loginRequestedRef = useRef(false)

  const needsUpdate = availability.code === 'version-too-old'
  const needsInstall = !availability.installed || needsUpdate
  const busy =
    stage === 'installing' ||
    stage === 'checking-install' ||
    stage === 'opening-login'

  useEffect(() => {
    setStage('idle')
    setCommand('')
    setLogs([])
    setMessage('')
    setLoginFailure('')
    setCopied(false)
    installStartedRef.current = false
    installFinishedRef.current = false
    continueAfterInstallRef.current = false
    loginRequestedRef.current = false
  }, [provider])

  useEffect(() => {
    if (!needsInstall) return
    let active = true
    void invoke('agent:installCommand', { provider }).then(
      (result) => {
        if (active) setCommand(result.command)
      },
      () => undefined
    )
    return () => {
      active = false
    }
  }, [needsInstall, provider])

  useEffect(() => {
    const refresh = (): void => onRefresh()
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    const interval = window.setInterval(refresh, 3_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [onRefresh])

  const finishInstallation = useCallback(
    (ok: boolean) => {
      if (installFinishedRef.current) return
      installFinishedRef.current = true
      installStartedRef.current = false
      continueAfterInstallRef.current = ok
      setStage(ok ? 'checking-install' : 'error')
      onRefresh()
    },
    [onRefresh]
  )

  useEffect(
    () =>
      onPush('agent:install-progress', (progress) => {
        if (progress.provider !== provider) return
        if (installStartedRef.current && progress.line !== '') {
          setLogs((current) => [...current.slice(-119), progress.line])
        }
        if (!progress.done) return
        // Every completed install invalidates this snapshot, even when another
        // surface initiated it. Only this surface's own install may auto-login.
        if (installStartedRef.current) {
          if (!progress.ok) {
            setMessage('설치를 완료하지 못했어요. 진행 로그를 확인해 주세요.')
          }
          finishInstallation(progress.ok)
        } else {
          onRefresh()
        }
      }),
    [finishInstallation, onRefresh, provider]
  )

  const openLogin = useCallback(() => {
    if (loginRequestedRef.current) return
    loginRequestedRef.current = true
    setStage('opening-login')
    setMessage('')
    setLoginFailure('')
    setCopied(false)
    void invoke('agent:login', { provider }).then(
      (result) => {
        loginRequestedRef.current = false
        if (result.ok) {
          setStage('waiting-login')
          setMessage('터미널에서 로그인을 마치면 자동으로 이어져요.')
          onRefresh()
          return
        }
        setStage('error')
        setLoginFailure(result.message)
      },
      () => {
        loginRequestedRef.current = false
        setStage('error')
        setLoginFailure('로그인 창을 열지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
    )
  }, [onRefresh, provider])

  useEffect(() => {
    if (!continueAfterInstallRef.current || needsInstall) return
    continueAfterInstallRef.current = false
    if (availability.loggedIn) {
      setStage('idle')
      return
    }
    openLogin()
  }, [availability.loggedIn, needsInstall, openLogin])

  const install = useCallback(() => {
    if (busy) return
    installStartedRef.current = true
    installFinishedRef.current = false
    continueAfterInstallRef.current = false
    setStage('installing')
    setLogs([])
    setMessage('')
    setLoginFailure('')

    const commandReady =
      command !== ''
        ? Promise.resolve()
        : invoke('agent:installCommand', { provider }).then((result) => {
            setCommand(result.command)
          })

    void commandReady.then(
      () =>
        invoke('agent:install', { provider }).then(
          (result) => {
            setMessage(result.message)
            finishInstallation(result.ok)
          },
          () => {
            setMessage('설치 요청을 완료하지 못했어요.')
            finishInstallation(false)
          }
        ),
      () => {
        setMessage('설치 명령어를 불러오지 못했어요.')
        finishInstallation(false)
      }
    )
  }, [busy, command, finishInstallation, provider])

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
    <GateCard eyebrow="SETUP" title={title}>
      <ProviderSelector
        provider={provider}
        onChange={onProviderChange}
        disabled={busy}
      />

      {needsUpdate ? (
        <p className="chat-gate__desc">
          현재 버전 {availability.version ?? '알 수 없음'}을 최신 버전으로
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

      {availability.reason !== undefined && availability.reason !== '' && (
        <p className="chat-gate__notice">{availability.reason}</p>
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
