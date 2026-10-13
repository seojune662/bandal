import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createLoginLauncher, type LoginLauncher } from '../../../src/main/features/agent/loginLauncher'
import type { BinaryLocator } from '../../../src/main/features/agent/binaryLocator'
import type { AgentLoginProgress, AgentProvider } from '../../../src/shared/types/agent-events'
import type { spawnClaude } from '../../../src/main/features/agent/platform'

const CLAUDE_URL = 'https://claude.com/cai/oauth/authorize?state=private-state&redirect_uri=http%3A%2F%2Flocalhost%3A4321%2Fcallback'
const MANUAL_URL = 'https://claude.com/cai/oauth/authorize?state=private-state&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode'
const CODEX_URL = 'https://auth.openai.com/oauth/authorize?state=private-state&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback'
const launchers: LoginLauncher[] = []
afterEach(() => { for (const launcher of launchers.splice(0)) launcher.dispose(); vi.useRealTimers() })

function fixture(provider: AgentProvider = 'codex', options: { platform?: NodeJS.Platform; timeoutMs?: number; autoReply?: boolean } = {}) {
  let loggedIn = false
  const locator: BinaryLocator = {
    locate: vi.fn(async () => ({ path: '/opt/provider/cli', version: '9.9.9' })),
    loginShellPath: vi.fn(async () => '/opt/node/bin:/usr/bin'),
    availability: vi.fn(async () => ({ installed: true, loggedIn })),
    reset: vi.fn()
  }
  const children: ChildProcess[] = []
  const rpcRequests: Record<string, any>[] = []
  const spawnCli = vi.fn((() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 99101 + children.length, exitCode: null, signalCode: null, kill: vi.fn(() => true)
    }) as unknown as ChildProcess
    child.stdin!.on('data', chunk => {
      if (provider !== 'codex') return
      const message = JSON.parse(String(chunk)); rpcRequests.push(message)
      if (options.autoReply !== false && message.id !== undefined) queueMicrotask(() => {
        child.stdout!.emit('data', Buffer.from(JSON.stringify({ id: message.id, result: message.method === 'account/login/start' ? { type: 'chatgpt', loginId: 'login-id', authUrl: CODEX_URL } : {} }) + '\n'))
      })
    })
    children.push(child)
    return child
  }) as typeof spawnClaude)
  let capturedUrl!: (url: string) => void
  const bridgeDispose = vi.fn(async () => undefined)
  const createBrowserBridge = vi.fn(async (onUrl: (url: string) => void) => {
    capturedUrl = onUrl
    return { browserPath: '/tmp/bandal/browser', dispose: bridgeDispose }
  })
  const killTree = vi.fn()
  const progress: AgentLoginProgress[] = []
  const openBrowser = vi.fn(async () => undefined)
  const openExternal = vi.fn(async () => undefined)
  const launcher = createLoginLauncher({
    locators: { codex: locator, 'claude-code': locator, gemini: locator },
    broadcast: event => progress.push(event), openBrowser, openExternal,
    spawnCli, createBrowserBridge, killTree, env: { PATH: '/usr/bin' },
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {})
  })
  launchers.push(launcher)
  return { launcher, locator, children, spawnCli, rpcRequests, progress, openBrowser, openExternal,
    bridgeDispose, createBrowserBridge, killTree, setLoggedIn: () => { loggedIn = true }, emitUrl: (url = CLAUDE_URL) => capturedUrl(url),
    notify: (params: Record<string, unknown>) => children[0]!.stdout!.emit('data', Buffer.from(JSON.stringify({ method: 'account/login/completed', params }) + '\n')) }
}
async function tick() { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('managed provider login', () => {
  test('Codex opens the managed auth URL and resolves only after callback plus credential verification', async () => {
    const f = fixture()
    const pending = f.launcher.login('codex', 'request-1')
    let resolved = false; void pending.then(() => { resolved = true })
    await tick()
    expect(f.spawnCli).toHaveBeenCalledWith('/opt/provider/cli', ['app-server'], expect.objectContaining({ env: expect.objectContaining({ PATH: '/opt/provider:/opt/node/bin:/usr/bin' }) }))
    expect(f.rpcRequests.map(request => request.method)).toEqual(['initialize', 'initialized', 'account/login/start'])
    expect(f.openBrowser).toHaveBeenCalledWith(CODEX_URL, expect.any(Object))
    expect(f.openExternal).not.toHaveBeenCalled()
    expect(resolved).toBe(false)
    f.notify({ loginId: 'different-login', success: true })
    await tick(); expect(resolved).toBe(false)
    f.setLoggedIn(); f.notify({ loginId: 'login-id', success: true })
    expect(await pending).toMatchObject({ ok: true })
    expect(f.progress.map(event => event.stage)).toEqual(['starting', 'waiting-browser', 'verifying', 'done'])
    expect(f.progress.every(event => event.requestId === 'request-1')).toBe(true)
    expect(f.progress.at(-1)).not.toHaveProperty('url')
  })
  test('provider success cannot falsely mark missing credentials connected', async () => {
    const f = fixture(); const pending = f.launcher.login('codex'); await tick()
    f.notify({ loginId: 'login-id', success: true })
    expect(await pending).toMatchObject({ ok: false })
    expect(f.progress.at(-1)?.stage).toBe('error')
  })
  test('provider diagnostics never reach progress or results', async () => {
    const f = fixture(); const pending = f.launcher.login('codex'); await tick()
    f.notify({ loginId: 'login-id', success: false, error: `Token failure secret-token ${CODEX_URL}` })
    expect(JSON.stringify(await pending)).not.toContain('secret-token')
    expect(JSON.stringify(f.progress)).not.toContain('secret-token')
  })
  test('Claude runs the explicit subscription command and intercepts the automatic callback URL', async () => {
    const f = fixture('claude-code'); const pending = f.launcher.login('claude-code', 'claude-1'); await tick()
    expect(f.spawnCli).toHaveBeenCalledWith('/opt/provider/cli', ['auth', 'login', '--claudeai'], expect.objectContaining({ env: expect.objectContaining({ BROWSER: '/tmp/bandal/browser', FORCE_HYPERLINK: '0' }) }))
    f.children[0]!.stdout!.emit('data', `If the browser didn't open, visit: ${MANUAL_URL}\nPaste code here if prompted > `)
    expect(f.openBrowser).not.toHaveBeenCalled()
    f.emitUrl()
    expect(f.openBrowser).toHaveBeenCalledWith(CLAUDE_URL, expect.any(Object))
    f.setLoggedIn(); f.children[0]!.emit('close', 0)
    expect(await pending).toMatchObject({ ok: true })
    expect(f.bridgeDispose).toHaveBeenCalledTimes(1)
  })
  test('Windows Claude shims use the shared cross-platform spawn path without external Terminal', async () => {
    const f = fixture('claude-code', { platform: 'win32' }); const pending = f.launcher.login('claude-code'); await tick()
    expect(f.spawnCli.mock.calls[0]?.[2].platform).toBe('win32')
    expect(f.createBrowserBridge).toHaveBeenCalledWith(expect.any(Function), { platform: 'win32' })
    f.launcher.cancel('claude-code'); expect(await pending).toMatchObject({ ok: false })
  })
  test('Claude manual URL fallback survives split output and supports code input without logs', async () => {
    vi.useFakeTimers()
    const f = fixture('claude-code'); const pending = f.launcher.login('claude-code', 'manual'); await tick()
    f.children[0]!.stdout!.emit('data', `visit: ${MANUAL_URL.slice(0, 45)}`)
    f.children[0]!.stdout!.emit('data', `${MANUAL_URL.slice(45)}\nPaste code here if prompted > `)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(f.openBrowser).toHaveBeenCalledWith(MANUAL_URL, expect.any(Object))
    const input: string[] = []; f.children[0]!.stdin!.on('data', chunk => input.push(String(chunk)))
    expect(f.launcher.submitCode('claude-code', 'code#state\nsecond-command', 'manual').ok).toBe(false)
    expect(f.launcher.submitCode('claude-code', ' secret-code#private-state ', 'manual').ok).toBe(true)
    expect(input).toEqual(['secret-code#private-state\n'])
    expect(JSON.stringify(f.progress)).not.toContain('secret-code')
    f.children[0]!.stderr!.emit('data', 'Invalid code. Please make sure the full code was copied.\n')
    expect(f.progress.at(-1)?.stage).toBe('waiting-browser')
    f.setLoggedIn(); f.children[0]!.emit('close', 0)
    expect(await pending).toMatchObject({ ok: true })
  })
  test('reopen uses the same pending URL and external browser requires the explicit action', async () => {
    const f = fixture(); const pending = f.launcher.login('codex', 'request'); await tick()
    expect((await f.launcher.reopen('codex', false, 'stale')).ok).toBe(false)
    expect((await f.launcher.reopen('codex', false, 'request')).ok).toBe(true)
    expect(f.openBrowser).toHaveBeenCalledTimes(2)
    expect(f.openExternal).not.toHaveBeenCalled()
    expect((await f.launcher.reopen('codex', true, 'request')).ok).toBe(true)
    expect(f.openExternal).toHaveBeenCalledWith(CODEX_URL)
    f.launcher.cancel('codex'); await pending
    expect((await f.launcher.reopen('codex')).ok).toBe(false)
  })
  test('cancel is scoped to the request and late output cannot corrupt a retry', async () => {
    const f = fixture('claude-code'); const first = f.launcher.login('claude-code', 'first'); await tick()
    expect(f.launcher.cancel('claude-code', 'other').ok).toBe(false)
    expect(f.launcher.cancel('claude-code', 'first').ok).toBe(true)
    expect(await first).toMatchObject({ ok: false })
    const oldChild = f.children[0]!
    const next = f.launcher.login('claude-code', 'next'); await tick()
    oldChild.emit('close', 0)
    expect(f.progress.at(-1)?.requestId).toBe('next')
    expect(f.progress.at(-1)?.stage).toBe('starting')
    f.emitUrl(); f.setLoggedIn(); f.children[1]!.emit('close', 0)
    expect(await next).toMatchObject({ ok: true })
  })
  test('cancel during binary discovery prevents any process or browser launch', async () => {
    const f = fixture(); let resolve!: (result: { path: string; version: string }) => void
    vi.mocked(f.locator.locate).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = f.launcher.login('codex', 'early')
    f.launcher.cancel('codex', 'early')
    resolve({ path: '/bin/cli', version: '1' }); await tick()
    expect(await pending).toMatchObject({ ok: false })
    expect(f.spawnCli).not.toHaveBeenCalled()
  })
  test('deduplicates repeated connection clicks and bounds waiting by a timeout', async () => {
    vi.useFakeTimers()
    const f = fixture('codex', { timeoutMs: 5000 })
    const first = f.launcher.login('codex', 'same')
    expect(f.launcher.login('codex', 'same')).toBe(first)
    await tick(); await vi.advanceTimersByTimeAsync(5000)
    expect(await first).toMatchObject({ ok: false, message: expect.stringContaining('초과') })
    expect(f.spawnCli).toHaveBeenCalledTimes(1)
    expect(f.children[0]!.kill).toHaveBeenCalled()
  })
  test('rejects untrusted OAuth destinations returned by a CLI', async () => {
    const f = fixture('codex', { autoReply: false }); const pending = f.launcher.login('codex'); await tick()
    f.children[0]!.stdout!.emit('data', JSON.stringify({ id: 1, result: {} }) + '\n'); await tick()
    f.children[0]!.stdout!.emit('data', JSON.stringify({ id: 2, result: { loginId: 'id', authUrl: 'https://auth.openai.com.attacker.test/oauth/authorize' } }) + '\n')
    expect(await pending).toMatchObject({ ok: false })
    expect(f.openBrowser).not.toHaveBeenCalled()
  })
  test('kills surviving POSIX descendants even when the direct CLI already exited', async () => {
    vi.useFakeTimers()
    const f = fixture('claude-code', { platform: 'darwin' })
    const pending = f.launcher.login('claude-code'); await tick()
    f.launcher.cancel('claude-code'); await pending
    Object.assign(f.children[0]!, { exitCode: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.killTree).toHaveBeenCalledWith(99101, 'SIGTERM', 'darwin')
    expect(f.killTree).toHaveBeenCalledWith(99101, 'SIGKILL', 'darwin')
  })
  test('updates an older Claude before a command could be mistaken for a prompt', async () => {
    const f = fixture('claude-code')
    vi.mocked(f.locator.locate).mockResolvedValueOnce({ path: '/opt/old/claude', version: '2.1.40' })
    expect(await f.launcher.login('claude-code')).toMatchObject({ ok: false, requiresUpdate: true })
    expect(f.spawnCli).not.toHaveBeenCalled()
    expect(f.createBrowserBridge).not.toHaveBeenCalled()
  })
  test('missing CLI has an actionable install message and does not spawn', async () => {
    const f = fixture(); vi.mocked(f.locator.locate).mockRejectedValueOnce(new Error('secret diagnostic'))
    expect(await f.launcher.login('codex')).toMatchObject({ ok: false, message: expect.stringContaining('설치') })
    expect(f.spawnCli).not.toHaveBeenCalled()
  })
})
