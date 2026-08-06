import {
  useCallback,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import type { AgentProvider } from '../../../../shared/types/agent-events'
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
  onRefresh: () => void
}): JSX.Element {
  return (
    <div className="chat-gate">
      <div className="chat-gate__card">
        <BandalMark size={36} className="chat-gate__moon" />
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

type InstallStage =
  | 'idle'
  | 'loading-command'
  | 'confirming'
  | 'installing'
  | 'complete'
  | 'error'

export function InstallCard({
  provider,
  onProviderChange,
  onRefresh
}: {
  provider: AgentProvider
  onProviderChange: (provider: AgentProvider) => void
  onRefresh: () => void
}): JSX.Element {
  const [stage, setStage] = useState<InstallStage>('idle')
  const [command, setCommand] = useState('')
  const [supported, setSupported] = useState(true)
  const [logs, setLogs] = useState<string[]>([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    setStage('idle')
    setCommand('')
    setSupported(true)
    setLogs([])
    setMessage('')
  }, [provider])

  useEffect(
    () =>
      onPush('agent:install-progress', (progress) => {
        if (progress.provider !== provider) {
          return
        }
        if (progress.line !== '') {
          setLogs((current) => [...current.slice(-119), progress.line])
        }
        if (progress.done) {
          setStage(progress.ok ? 'complete' : 'error')
        }
      }),
    [provider]
  )

  const showCommand = useCallback(() => {
    setStage('loading-command')
    setMessage('')
    void invoke('agent:installCommand', { provider }).then(
      (result) => {
        setCommand(result.command)
        setSupported(result.supported)
        setStage('confirming')
        if (!result.supported) {
          setMessage(
            provider === 'codex'
              ? 'npm이 없어 자동 설치할 수 없어요. Node.js와 npm을 먼저 설치해 주세요.'
              : '이 운영체제에서는 앱 내 자동 설치를 지원하지 않아요.'
          )
        }
      },
      () => {
        setStage('error')
        setMessage('설치 명령어를 불러오지 못했어요.')
      }
    )
  }, [provider])

  const install = useCallback(() => {
    if (!supported || stage === 'installing') {
      return
    }
    setLogs([])
    setMessage('')
    setStage('installing')
    void invoke('agent:install', { provider }).then(
      (result) => {
        setStage(result.ok ? 'complete' : 'error')
        setMessage(result.message)
        if (result.ok) {
          onRefresh()
        }
      },
      () => {
        setStage('error')
        setMessage('설치 요청을 완료하지 못했어요.')
      }
    )
  }, [onRefresh, provider, stage, supported])

  const cancelConfirmation = useCallback(() => {
    setStage('idle')
    setCommand('')
    setMessage('')
  }, [])

  return (
    <GateCard
      eyebrow="SETUP"
      title={`${providerLabel(provider)} 설치가 필요해요`}
      onRefresh={onRefresh}
    >
      <ProviderSelector
        provider={provider}
        onChange={onProviderChange}
        disabled={stage === 'installing'}
      />
      <p className="chat-gate__desc">
        AI 튜터는 내 컴퓨터에서 {providerLabel(provider)} CLI를 실행해요.
        설치하기 전에 실행할 명령어를 그대로 보여드릴게요.
      </p>

      {(stage === 'idle' || stage === 'loading-command') && (
        <button
          type="button"
          className="chat-gate__primary"
          disabled={stage === 'loading-command'}
          onClick={showCommand}
        >
          {stage === 'loading-command' ? '명령어 확인 중…' : '앱에서 설치'}
        </button>
      )}

      {command !== '' && (
        <div className="chat-gate__command">
          <code>{command}</code>
        </div>
      )}

      {stage === 'confirming' && supported && (
        <div className="chat-gate__actions">
          <button type="button" className="chat-gate__primary" onClick={install}>
            설치
          </button>
          <button
            type="button"
            className="chat-gate__secondary"
            onClick={cancelConfirmation}
          >
            취소
          </button>
        </div>
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
    </GateCard>
  )
}

function ExternalLink({ url, children }: { url: string; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      className="chat-gate__external"
      onClick={() => {
        void invoke('shell:openExternal', { url }).catch(() => undefined)
      }}
    >
      {children}
    </button>
  )
}

export function LoginCard({
  provider,
  onProviderChange,
  onRefresh
}: {
  provider: AgentProvider
  onProviderChange: (provider: AgentProvider) => void
  onRefresh: () => void
}): JSX.Element {
  const cli = provider === 'claude-code' ? 'claude' : 'codex'
  return (
    <GateCard
      eyebrow="ACCOUNT"
      title={`${providerLabel(provider)} 로그인이 필요해요`}
      onRefresh={onRefresh}
    >
      <ProviderSelector provider={provider} onChange={onProviderChange} />
      {provider === 'claude-code' ? (
        <ol className="chat-gate__steps">
          <li>
            <span>Claude 계정이 없다면 먼저 가입해요.</span>
            <ExternalLink url="https://claude.ai/">claude.ai 열기</ExternalLink>
          </li>
          <li>
            <span>무료 사용량과 유료 요금제를 확인하고 나에게 맞게 선택해요.</span>
            <ExternalLink url="https://claude.com/pricing">요금제 보기</ExternalLink>
          </li>
          <li>
            <span>
              터미널에서 <code className="chat-gate__inline-code">claude</code>를
              실행하고 브라우저 로그인 안내를 마쳐요.
            </span>
          </li>
        </ol>
      ) : (
        <ol className="chat-gate__steps">
          <li>
            <span>ChatGPT 계정이 없다면 먼저 가입해요.</span>
            <ExternalLink url="https://chatgpt.com/">ChatGPT 열기</ExternalLink>
          </li>
          <li>
            <span>
              터미널에서 <code className="chat-gate__inline-code">codex</code>를
              실행하고 ChatGPT 로그인을 선택해요.
            </span>
          </li>
        </ol>
      )}
      <p className="chat-gate__desc">
        로그인 완료 후 <code className="chat-gate__inline-code">{cli}</code>를
        종료해도 괜찮아요. Bandal로 돌아와 재확인을 눌러주세요.
      </p>
    </GateCard>
  )
}
