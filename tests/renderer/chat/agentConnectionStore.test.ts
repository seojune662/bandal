import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { acquireAgentConnection, cancelAgentLogin, CONNECTION_POLL_MS, INSTALL_CHECK_TIMEOUT_MS, isAgentConnectionReady, prepareAgentConnection, refreshAgentConnection, refreshAgentConnectionAfterMutation, resetAgentConnectionsForTests, seedAgentAvailability, startAgentConnection, startAgentInstall, startAgentLogin, useAgentConnectionStore } from '../../../src/renderer/src/features/chat/agentConnectionStore'

const disconnected = { installed: false, loggedIn: false }
const signedOut = { installed: true, loggedIn: false }
const ready = { installed: true, loggedIn: true }
const snapshot = () => useAgentConnectionStore.getState().connections.codex
function deferred<T>() { let resolve!: (result: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const handlers = new Map<string, (payload: any) => void>()
function transport(invoke: ReturnType<typeof vi.fn>): void {
  setIpcAdapter({ invoke, on: (channel: string, callback: (payload: any) => void) => { handlers.set(channel, callback); return () => handlers.delete(channel) } } as unknown as IpcAdapter)
}
beforeEach(() => { vi.useFakeTimers(); handlers.clear() })
afterEach(() => { resetAgentConnectionsForTests(); setIpcAdapter(null); vi.useRealTimers() })

describe('shared AI connection controller', () => {
  test('deduplicates probes and ignores an older response after a forced refresh', async () => {
    const old = deferred<any>(), fresh = deferred<any>()
    const invoke = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    transport(invoke)
    const first = refreshAgentConnection('codex')
    expect(refreshAgentConnection('codex')).toBe(first)
    const forced = refreshAgentConnection('codex', true)
    expect(refreshAgentConnection('codex', true)).toBe(forced)
    fresh.resolve(ready); await forced
    old.resolve(disconnected); await first
    expect(snapshot().availability).toEqual(ready)
    expect(snapshot().loading).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  test('a credential mutation replaces even an in-flight refresh and invalidates models', async () => {
    const old = deferred<any>(), fresh = deferred<any>()
    const invoke = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    transport(invoke)
    const initial = refreshAgentConnection('codex', true)
    const mutation = refreshAgentConnectionAfterMutation('codex')
    fresh.resolve(ready); await mutation
    old.resolve(signedOut); await initial
    expect(snapshot().availability).toEqual(ready)
    expect(snapshot().modelsRevision).toBe(1)
  })
  test('a stale chat seed cannot overwrite authoritative availability', async () => {
    transport(vi.fn(async () => signedOut))
    seedAgentAvailability('codex', ready)
    await refreshAgentConnection('codex', true)
    seedAgentAvailability('codex', ready)
    expect(snapshot().availability).toEqual(signedOut)
    expect(isAgentConnectionReady({ ...ready, code: 'process-crashed' })).toBe(false)
    expect(isAgentConnectionReady({ ...ready, code: 'version-too-old' })).toBe(false)
  })
  test('push plus install response continue to login once and remount shares that operation', async () => {
    const installation = deferred<any>()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'agent:installCommand') return { command: 'npm install -g @openai/codex', supported: true }
      if (channel === 'agent:install') return installation.promise
      if (channel === 'agent:login') return { ok: true, message: 'opened' }
      return signedOut
    })
    transport(invoke)
    const release = acquireAgentConnection('codex')
    await flush()
    const installing = startAgentInstall('codex')
    void startAgentInstall('codex')
    await flush()
    handlers.get('agent:install-progress')!({ provider: 'codex', line: 'installed', done: true, ok: true })
    await flush()
    installation.resolve({ ok: true, message: 'installed' })
    await installing; await flush()
    release()
    const releaseAgain = acquireAgentConnection('codex')
    await flush()
    handlers.get('agent:install-progress')!({ provider: 'codex', line: '', done: true, ok: true })
    await flush()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:install')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:login')).toHaveLength(1)
    expect(snapshot().stage).toBe('verifying-login')
    releaseAgain()
  })
  test('another surface install completion refreshes state without auto login', async () => {
    const invoke = vi.fn(async () => signedOut)
    transport(invoke)
    const release = acquireAgentConnection('codex'); await flush()
    handlers.get('agent:install-progress')!({ provider: 'codex', line: 'done', done: true, ok: true }); await flush()
    expect(invoke.mock.calls.every(([channel]) => channel === 'agent:availability')).toBe(true)
    release()
  })
  test('stops verification after 60 seconds and enables retry for a binary that stays unsupported', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'agent:installCommand' ? { command: 'install', supported: true } : channel === 'agent:install' ? { ok: true, message: 'done' } : { ...ready, code: 'version-too-old' })
    transport(invoke)
    await startAgentInstall('codex')
    expect(snapshot().stage).toBe('checking-install')
    await vi.advanceTimersByTimeAsync(INSTALL_CHECK_TIMEOUT_MS)
    expect(snapshot().stage).toBe('error')
    expect(snapshot().error).toContain('설치 후 연결')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:login')).toHaveLength(0)
    const count = invoke.mock.calls.length
    await vi.advanceTimersByTimeAsync(CONNECTION_POLL_MS * 2)
    expect(invoke).toHaveBeenCalledTimes(count)
  })
  test('waits for browser completion and verifies real credentials before declaring ready', async () => {
    let availability = signedOut
    const completion = deferred<any>()
    const invoke = vi.fn(async (channel: string) => channel === 'agent:login' ? completion.promise : availability)
    transport(invoke)
    const login = startAgentLogin('codex'); void startAgentLogin('codex')
    await flush()
    const requestId = invoke.mock.calls.find(([channel]) => channel === 'agent:login')![1].requestId
    handlers.get('agent:login-progress')!({ provider: 'codex', requestId, stage: 'waiting-browser', message: '로그인해 주세요.' })
    expect(snapshot().stage).toBe('waiting-login')
    void startAgentConnection('codex')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:login')).toHaveLength(1)
    completion.resolve({ ok: true, message: 'done' }); await login
    expect(snapshot().stage).toBe('verifying-login')
    expect(snapshot().availability).toEqual(signedOut)
    availability = ready
    await vi.advanceTimersByTimeAsync(CONNECTION_POLL_MS)
    expect(snapshot().stage).toBe('idle')
    expect(snapshot().availability).toEqual(ready)
  })
  test('cancellation ignores the old completion and old progress while a retry is active', async () => {
    const first = deferred<any>(), second = deferred<any>(); let loginCount = 0
    const invoke = vi.fn(async (channel: string) => channel === 'agent:login' ? ++loginCount === 1 ? first.promise : second.promise : channel === 'agent:cancelLogin' ? { ok: true } : signedOut)
    transport(invoke)
    const attempt = startAgentLogin('codex'); await flush()
    const oldId = invoke.mock.calls.find(([channel]) => channel === 'agent:login')![1].requestId
    await cancelAgentLogin('codex')
    expect(snapshot().stage).toBe('idle')
    const retry = startAgentLogin('codex'); await flush()
    const newId = invoke.mock.calls.filter(([channel]) => channel === 'agent:login')[1][1].requestId
    expect(newId).not.toBe(oldId)
    handlers.get('agent:login-progress')!({ provider: 'codex', requestId: oldId, stage: 'error', message: 'stale error' })
    first.resolve({ ok: false, message: 'cancelled' }); await attempt
    expect(snapshot().stage).toBe('opening-login')
    expect(snapshot().error).toBeNull()
    second.resolve({ ok: false, message: '계정 접근 권한을 확인해 주세요.' }); await retry
    expect(snapshot().stage).toBe('error')
    expect(snapshot().error).toBe('계정 접근 권한을 확인해 주세요.')
  })
  test('connection retry uses the installed tool instead of installing again', async () => {
    transport(vi.fn(async (channel: string) => channel === 'agent:login' ? { ok: false, message: 'retry later' } : signedOut))
    seedAgentAvailability('codex', signedOut)
    await startAgentConnection('codex')
    expect(snapshot().stage).toBe('error')
    expect(snapshot().command).toBe('')
  })
  test('keeps installer failure details and does not run login', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'agent:installCommand' ? { command: 'install', supported: true } : { ok: false, message: '설치 경로에 쓸 수 없습니다.' })
    transport(invoke)
    await startAgentInstall('codex')
    expect(snapshot().error).toBe('설치 경로에 쓸 수 없습니다.')
    expect(snapshot().stage).toBe('error')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:login')).toHaveLength(0)
  })
  test('explicit retry rechecks installer support after npm becomes available', async () => {
    let supported = false
    const invoke = vi.fn(async (channel: string) => channel === 'agent:installCommand' ? { command: 'install', supported } : { ok: false, message: 'fixture stop' })
    transport(invoke)
    await prepareAgentConnection('codex')
    supported = true
    await startAgentInstall('codex')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:installCommand')).toHaveLength(2)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:install')).toHaveLength(1)
    expect(snapshot().supported).toBe(true)
  })
  test('a retry support check supersedes an older in-flight command lookup', async () => {
    const old = deferred<any>(); let calls = 0
    const invoke = vi.fn(async (channel: string) => channel === 'agent:installCommand' ? ++calls === 1 ? old.promise : { command: 'install new', supported: true } : { ok: false, message: 'fixture stop' })
    transport(invoke)
    const initial = prepareAgentConnection('codex')
    await startAgentInstall('codex')
    old.resolve({ command: 'install old', supported: false }); await initial
    expect(snapshot()).toMatchObject({ command: 'install new', supported: true })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:install')).toHaveLength(1)
  })
  test('model revision changes on actual readiness, account, plan or version changes, but not unchanged probes', async () => {
    let availability: any = signedOut
    transport(vi.fn(async () => availability))
    await refreshAgentConnectionAfterMutation('codex')
    expect(snapshot().modelsRevision).toBe(0)
    availability = { ...ready, version: '0.158.0', accountEmail: 'one@example.test' }
    await refreshAgentConnection('codex', true)
    expect(snapshot().modelsRevision).toBe(1)
    await refreshAgentConnection('codex', true)
    expect(snapshot().modelsRevision).toBe(1)
    for (const change of [{ version: '0.159.0' }, { accountEmail: 'two@example.test' }, { subscriptionType: 'pro' }]) {
      const before = snapshot().modelsRevision
      availability = { ...availability, ...change }
      await refreshAgentConnection('codex', true)
      expect(snapshot().modelsRevision).toBe(before + 1)
    }
  })
})

test('repairs an outdated login tool once and does not loop if the old executable stays selected', async () => {
  seedAgentAvailability('claude-code', signedOut)
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'agent:login') return { ok: false, requiresUpdate: true, message: '연결 도구를 업데이트해 주세요.' }
    if (channel === 'agent:installCommand') return { supported: true, command: 'official installer' }
    if (channel === 'agent:install') return { ok: true, message: 'installed' }
    return signedOut
  })
  transport(invoke)
  await startAgentConnection('claude-code'); await flush()
  expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:install')).toHaveLength(1)
  expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:login')).toHaveLength(2)
  expect(useAgentConnectionStore.getState().connections['claude-code'].stage).toBe('error')
})

test('late cancel rejection cannot overwrite a new login attempt', async () => {
  let rejectCancel!: (reason: Error) => void
  const cancellation = new Promise((_resolve, reject) => { rejectCancel = reject })
  const completion = deferred<any>()
  transport(vi.fn(async (channel: string) => channel === 'agent:login' ? completion.promise : channel === 'agent:cancelLogin' ? cancellation : signedOut))
  const first = startAgentLogin('codex'); await flush()
  const cancelled = cancelAgentLogin('codex')
  const second = startAgentLogin('codex'); await flush()
  rejectCancel(new Error('late cancel failure')); await cancelled
  expect(snapshot().stage).toBe('opening-login')
  expect(snapshot().error).toBeNull()
  completion.resolve({ ok: false, message: 'finished' }); await first; await second
})
