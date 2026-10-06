import { create } from 'zustand'
import { isAgentReady } from '../../../../shared/agentProviderSelection'
import { AGENT_PROVIDERS, isAgentProvider, type AgentAvailability, type AgentProvider } from '../../../../shared/types/agent-events'
import { invoke, onPush, type Unsubscribe } from '../../lib/ipc'

export const INSTALL_CHECK_TIMEOUT_MS = 60_000
export const LOGIN_CHECK_TIMEOUT_MS = 5 * 60_000
export const CONNECTION_POLL_MS = 3_000

export type ConnectionStage = 'idle' | 'installing' | 'checking-install' | 'opening-login' | 'waiting-login' | 'error'
export interface AgentConnectionSnapshot {
  availability: AgentAvailability | null
  loading: boolean
  stage: ConnectionStage
  command: string
  supported: boolean | null
  logs: string[]
  message: string
  error: string | null
  availabilityError: string | null
  loginFailure: string
  modelsRevision: number
  modelsInvalidationRevision: number
  availabilityRevision: number
}
const emptyConnection = (): AgentConnectionSnapshot => ({ availability: null, loading: false, stage: 'idle', command: '', supported: null, logs: [], message: '', error: null, availabilityError: null, loginFailure: '', modelsRevision: 0, modelsInvalidationRevision: 0, availabilityRevision: 0 })
const initialConnections = () => Object.fromEntries(AGENT_PROVIDERS.map(provider => [provider, emptyConnection()])) as Record<AgentProvider, AgentConnectionSnapshot>
export const useAgentConnectionStore = create<{ connections: Record<AgentProvider, AgentConnectionSnapshot> }>(() => ({ connections: initialConnections() }))

interface ConnectionRuntime {
  refs: number
  generation: number
  operation: number
  probe: { promise: Promise<void>; refresh: boolean } | null
  command: Promise<void> | null
  commandGeneration: number
  modelsDirty: boolean
  poll: ReturnType<typeof setTimeout> | null
  deadline: ReturnType<typeof setTimeout> | null
  autoLogin: boolean
}
const runtimes = new Map<AgentProvider, ConnectionRuntime>()
let unsubscribeProgress: Unsubscribe | null = null
let stopFocusListeners: (() => void) | null = null

function runtimeFor(provider: AgentProvider): ConnectionRuntime {
  let runtime = runtimes.get(provider)
  if (!runtime) {
    runtime = { refs: 0, generation: 0, operation: 0, probe: null, command: null, commandGeneration: 0, modelsDirty: false, poll: null, deadline: null, autoLogin: false }
    runtimes.set(provider, runtime)
  }
  return runtime
}
function snapshot(provider: AgentProvider): AgentConnectionSnapshot { return useAgentConnectionStore.getState().connections[provider] }
function update(provider: AgentProvider, change: Partial<AgentConnectionSnapshot>): void {
  useAgentConnectionStore.setState(state => ({ connections: { ...state.connections, [provider]: { ...state.connections[provider], ...change } } }))
}
export function hasCompatibleAgentBinary(availability: AgentAvailability | null): boolean {
  return availability?.installed === true && (availability.code === undefined || availability.code === 'not-logged-in')
}
export function isAgentConnectionReady(availability: AgentAvailability | null): boolean {
  return isAgentReady(availability ?? undefined)
}
export function isAgentConnectionBusy(stage: ConnectionStage): boolean {
  return stage === 'installing' || stage === 'checking-install' || stage === 'opening-login'
}
function clearTimers(runtime: ConnectionRuntime): void {
  if (runtime.poll !== null) clearTimeout(runtime.poll)
  if (runtime.deadline !== null) clearTimeout(runtime.deadline)
  runtime.poll = null
  runtime.deadline = null
}
function finishReady(provider: AgentProvider): void {
  const runtime = runtimeFor(provider)
  clearTimers(runtime)
  runtime.autoLogin = false
  update(provider, { stage: 'idle', error: null, loginFailure: '', message: '' })
}
function schedulePoll(provider: AgentProvider): void {
  const runtime = runtimeFor(provider)
  const stage = snapshot(provider).stage
  if (runtime.poll !== null || (stage !== 'checking-install' && stage !== 'waiting-login')) return
  runtime.poll = setTimeout(() => {
    runtime.poll = null
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { schedulePoll(provider); return }
    void refreshAgentConnection(provider, true)
  }, CONNECTION_POLL_MS)
}
function startDeadline(provider: AgentProvider, timeout: number, message: string): void {
  const runtime = runtimeFor(provider)
  if (runtime.deadline !== null) clearTimeout(runtime.deadline)
  const operation = runtime.operation
  runtime.deadline = setTimeout(() => {
    if (runtime.operation !== operation) return
    runtime.operation += 1
    runtime.autoLogin = false
    clearTimers(runtime)
    update(provider, { stage: 'error', error: message, message: '' })
  }, timeout)
}
function settleAvailability(provider: AgentProvider): void {
  const runtime = runtimeFor(provider)
  const current = snapshot(provider)
  if (current.stage === 'checking-install' && hasCompatibleAgentBinary(current.availability)) {
    clearTimers(runtime)
    if (isAgentConnectionReady(current.availability)) finishReady(provider)
    else if (runtime.autoLogin) {
      runtime.autoLogin = false
      void startAgentLogin(provider)
    }
  } else if ((current.stage === 'waiting-login' || current.stage === 'error') && isAgentConnectionReady(current.availability)) finishReady(provider)
  schedulePoll(provider)
}
function installListeners(): void {
  if (unsubscribeProgress !== null) return
  unsubscribeProgress = onPush('agent:install-progress', progress => {
    if (!isAgentProvider(progress.provider)) return
    const provider = progress.provider
    if (snapshot(provider).stage === 'installing' && progress.line !== '') update(provider, { logs: [...snapshot(provider).logs.slice(-119), progress.line] })
    // The invoking surface owns continuation. A broadcast from another install
    // must never open a second login terminal or finish an unrelated operation.
    if (progress.done) {
      if (snapshot(provider).stage === 'installing') void refreshAgentConnection(provider, true)
      else void refreshAgentConnectionAfterMutation(provider)
    }
  })
  if (typeof window === 'undefined') return
  const refreshVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    for (const [provider, runtime] of runtimes) if (runtime.refs > 0 || snapshot(provider).stage === 'waiting-login') void refreshAgentConnection(provider, true)
  }
  window.addEventListener('focus', refreshVisible)
  document.addEventListener('visibilitychange', refreshVisible)
  stopFocusListeners = () => { window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible) }
}

/** Renderer-wide single flight. Forced refresh supersedes an older cached probe. */
export function refreshAgentConnection(provider: AgentProvider, refresh = false): Promise<void> {
  const runtime = runtimeFor(provider)
  if (runtime.probe !== null && (!refresh || runtime.probe.refresh)) return runtime.probe.promise
  const generation = ++runtime.generation
  update(provider, { loading: true, availabilityError: null })
  const probe = { refresh, promise: Promise.resolve() }
  runtime.probe = probe
  probe.promise = invoke('agent:availability', { provider, ...(refresh ? { refresh: true } : {}) }).then(
    availability => {
      if (runtime.generation !== generation) return
      const previous = snapshot(provider)
      const accountChanged = previous.availability?.accountEmail !== availability.accountEmail || previous.availability?.subscriptionType !== availability.subscriptionType || previous.availability?.version !== availability.version
      const refreshModels = isAgentConnectionReady(availability) && (runtime.modelsDirty || !isAgentConnectionReady(previous.availability) || accountChanged)
      if (refreshModels) runtime.modelsDirty = false
      update(provider, { availability, availabilityRevision: previous.availabilityRevision + 1, modelsRevision: previous.modelsRevision + (refreshModels ? 1 : 0), loading: false, ...(previous.stage === 'idle' ? { error: null } : {}) })
      settleAvailability(provider)
    },
    () => {
      if (runtime.generation !== generation) return
      update(provider, { loading: false, availabilityError: 'AI 연결 상태를 확인하지 못했어요. 다시 확인해 주세요.' })
      schedulePoll(provider)
    }
  ).finally(() => { if (runtime.probe === probe) runtime.probe = null })
  return probe.promise
}
export function seedAgentAvailability(provider: AgentProvider, availability: AgentAvailability): void {
  if (snapshot(provider).availability === null && !snapshot(provider).loading) update(provider, { availability })
}
export function acquireAgentConnection(provider: AgentProvider): () => void {
  const runtime = runtimeFor(provider)
  runtime.refs += 1
  installListeners()
  void refreshAgentConnection(provider)
  let released = false
  return () => { if (!released) { released = true; runtime.refs = Math.max(0, runtime.refs - 1) } }
}
export function prepareAgentConnection(provider: AgentProvider, refresh = false): Promise<void> {
  const runtime = runtimeFor(provider)
  if (!refresh && runtime.command !== null) return runtime.command
  if (!refresh && snapshot(provider).command !== '') return Promise.resolve()
  const generation = ++runtime.commandGeneration
  runtime.command = invoke('agent:installCommand', { provider }).then(result => { if (runtime.commandGeneration === generation) update(provider, { command: result.command, supported: result.supported }) }).finally(() => { if (runtime.commandGeneration === generation) runtime.command = null })
  return runtime.command
}
export async function startAgentInstall(provider: AgentProvider): Promise<void> {
  const runtime = runtimeFor(provider)
  if (isAgentConnectionBusy(snapshot(provider).stage)) return
  installListeners()
  clearTimers(runtime)
  const operation = ++runtime.operation
  runtime.autoLogin = false
  update(provider, { stage: 'installing', logs: [], error: null, message: '', loginFailure: '' })
  try {
    await prepareAgentConnection(provider, true)
    if (runtime.operation !== operation) return
    if (snapshot(provider).supported === false) throw new Error('자동 설치를 사용할 수 없어요. 표시된 설치 명령어를 터미널에서 실행해 주세요.')
    const result = await invoke('agent:install', { provider })
    if (runtime.operation !== operation) return
    if (!result.ok) throw new Error(result.message)
    runtime.autoLogin = true
    update(provider, { stage: 'checking-install', message: result.message })
    startDeadline(provider, INSTALL_CHECK_TIMEOUT_MS, '설치 후 연결을 확인하지 못했어요. 설치 경로와 버전을 확인한 뒤 다시 시도해 주세요.')
    await refreshAgentConnectionAfterMutation(provider)
  } catch (error) {
    if (runtime.operation !== operation) return
    clearTimers(runtime)
    update(provider, { stage: 'error', error: error instanceof Error ? error.message : '설치 요청을 완료하지 못했어요.' })
  }
}
export async function startAgentLogin(provider: AgentProvider): Promise<void> {
  const runtime = runtimeFor(provider)
  if (snapshot(provider).stage === 'opening-login' || snapshot(provider).stage === 'installing') return
  installListeners()
  clearTimers(runtime)
  const operation = ++runtime.operation
  update(provider, { stage: 'opening-login', error: null, loginFailure: '', message: '' })
  try {
    const result = await invoke('agent:login', { provider })
    if (runtime.operation !== operation) return
    if (!result.ok) { update(provider, { stage: 'error', loginFailure: result.message }); return }
    update(provider, { stage: 'waiting-login', message: '터미널에서 로그인을 마치면 자동으로 이어져요.' })
    startDeadline(provider, LOGIN_CHECK_TIMEOUT_MS, '로그인 확인을 잠시 멈췄어요. 터미널에서 로그인을 마친 뒤 다시 확인해 주세요.')
    await refreshAgentConnectionAfterMutation(provider)
  } catch {
    if (runtime.operation !== operation) return
    update(provider, { stage: 'error', error: '로그인 창을 열지 못했어요. 다시 시도해 주세요.' })
  }
}
/** A mutation must not reuse a probe begun before credentials/installation changed. */
export function refreshAgentConnectionAfterMutation(provider: AgentProvider): Promise<void> {
  const runtime = runtimeFor(provider)
  runtime.generation += 1
  runtime.probe = null
  runtime.modelsDirty = true
  update(provider, { modelsInvalidationRevision: snapshot(provider).modelsInvalidationRevision + 1 })
  return refreshAgentConnection(provider, true)
}
export function resetAgentConnectionsForTests(): void {
  for (const runtime of runtimes.values()) { runtime.generation += 1; runtime.operation += 1; runtime.commandGeneration += 1; clearTimers(runtime) }
  runtimes.clear()
  unsubscribeProgress?.()
  unsubscribeProgress = null
  stopFocusListeners?.()
  stopFocusListeners = null
  useAgentConnectionStore.setState({ connections: initialConnections() })
}
