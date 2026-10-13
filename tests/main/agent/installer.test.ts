import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  AGENT_INSTALL_TIMEOUT_MS,
  CLAUDE_INSTALL_COMMAND,
  CLAUDE_INSTALL_COMMAND_WINDOWS,
  CODEX_INSTALL_COMMAND,
  CODEX_INSTALL_COMMAND_WINDOWS,
  GEMINI_INSTALL_COMMAND,
  createAgentInstaller
} from '../../../src/main/features/agent/installer'
import type { BinaryLocator } from '../../../src/main/features/agent/binaryLocator'
import type { AgentInstallProgress } from '../../../src/shared/ipc/events'
import type { AgentProvider } from '../../../src/shared/types/agent-events'

afterEach(() => { vi.useRealTimers() })

function setup(platform: NodeJS.Platform = 'darwin') {
  const children: ChildProcess[] = []
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 100 + children.length,
      stdout: new PassThrough(),
      stderr: new PassThrough()
    }) as unknown as ChildProcess
    children.push(child)
    return child
  })
  const stub = (): BinaryLocator => ({
    locate: vi.fn(async () => ({ path: '/stub', version: '9.9.9' })),
    availability: async () => ({ installed: true, loggedIn: true }),
    loginShellPath: async () => null,
    reset: vi.fn()
  })
  const locators = { 'claude-code': stub(), codex: stub(), gemini: stub() }
  const progress: AgentInstallProgress[] = []
  const kill = vi.fn()
  const resolveNpm = vi.fn(() => null)
  const installer = createAgentInstaller({
    platform,
    env: {},
    spawn,
    kill,
    resolveNpm,
    locators,
    broadcast: (event) => { progress.push(event) }
  })
  return { installer, children, spawn, kill, resolveNpm, locators, progress }
}

describe('native installer on a computer without Node or npm', () => {
  test.each([
    ['darwin', 'claude-code', CLAUDE_INSTALL_COMMAND],
    ['darwin', 'codex', CODEX_INSTALL_COMMAND],
    ['win32', 'claude-code', CLAUDE_INSTALL_COMMAND_WINDOWS],
    ['win32', 'codex', CODEX_INSTALL_COMMAND_WINDOWS]
  ] as const)('%s can install %s without checking npm', async (platform, provider, command) => {
    const subject = setup(platform)
    expect(subject.installer.commandFor(provider)).toEqual({ command, supported: true })
    const running = subject.installer.install(provider)
    expect(subject.resolveNpm).not.toHaveBeenCalled()
    expect(subject.spawn).toHaveBeenCalledTimes(1)
    if (platform === 'win32') {
      expect(subject.spawn).toHaveBeenCalledWith('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `$ErrorActionPreference = 'Stop'; ${command}`
      ], expect.objectContaining({ platform: 'win32', stdio: ['ignore', 'pipe', 'pipe'] }))
    } else {
      expect(subject.spawn).toHaveBeenCalledWith('/bin/bash', ['-o', 'pipefail', '-c', command],
        expect.objectContaining({ env: expect.objectContaining({ PATH: '/bin:/usr/bin:/usr/sbin:/sbin' }) }))
    }
    if (provider === 'codex') {
      expect(subject.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array),
        expect.objectContaining({ env: expect.objectContaining({ CODEX_NON_INTERACTIVE: '1' }) }))
    }
    subject.children[0]!.emit('close', 0, null)
    await expect(running).resolves.toMatchObject({ ok: true })
    expect(subject.locators[provider].reset).toHaveBeenCalledOnce()
    expect(subject.locators[provider].locate).toHaveBeenCalledOnce()
    expect(subject.progress.at(-1)).toMatchObject({ provider, done: true, ok: true })
  })

  test('keeps Gemini npm support separate from native subscription providers', async () => {
    const subject = setup()
    expect(subject.installer.commandFor('gemini')).toEqual({ command: GEMINI_INSTALL_COMMAND, supported: false })
    await expect(subject.installer.install('gemini')).resolves.toMatchObject({ ok: false })
    expect(subject.spawn).not.toHaveBeenCalled()
  })
})

describe('installation recovery and verification', () => {
  test('duplicate clicks share an installation and a failed run can be retried', async () => {
    const subject = setup()
    const first = subject.installer.install('codex')
    expect(subject.installer.install('codex')).toBe(first)
    subject.children[0]!.stderr!.emit('data', Buffer.from('\u001b[31mcurl: (6) Could not resolve host\u001b[0m'))
    subject.children[0]!.emit('close', 6, null)
    await expect(first).resolves.toEqual({ ok: false, message: expect.stringContaining('Could not resolve host') })
    expect(subject.locators.codex.locate).not.toHaveBeenCalled()
    const retry = subject.installer.install('codex')
    expect(subject.spawn).toHaveBeenCalledTimes(2)
    subject.children[1]!.emit('close', 0, null)
    await expect(retry).resolves.toMatchObject({ ok: true })
  })

  test.each(['darwin', 'win32'] as const)('timeout on %s kills descendants and ends progress once', async (platform) => {
    vi.useFakeTimers()
    const subject = setup(platform)
    const running = subject.installer.install('claude-code')
    await vi.advanceTimersByTimeAsync(AGENT_INSTALL_TIMEOUT_MS)
    await expect(running).resolves.toMatchObject({ ok: false })
    expect(subject.kill).toHaveBeenCalledWith(100, 'SIGKILL', platform)
    subject.children[0]!.stderr!.emit('data', Buffer.from('late output\n'))
    subject.children[0]!.emit('close', 0, null)
    expect(subject.progress.filter((event) => event.done)).toHaveLength(1)
    expect(subject.progress.at(-1)).toMatchObject({ done: true, ok: false })
    expect(subject.locators['claude-code'].locate).not.toHaveBeenCalled()
  })

  test('does not report success when the new CLI cannot be located', async () => {
    const subject = setup()
    vi.mocked(subject.locators.codex.locate).mockRejectedValue(new Error('missing'))
    const running = subject.installer.install('codex')
    subject.children[0]!.emit('close', 0, null)
    await expect(running).resolves.toMatchObject({ ok: false })
  })

  test('does not report a protocol-incompatible Codex as installed successfully', async () => {
    const subject = setup()
    vi.mocked(subject.locators.codex.locate).mockResolvedValue({ path: '/old/codex', version: '0.100.0' })
    const running = subject.installer.install('codex')
    subject.children[0]!.emit('close', 0, null)
    await expect(running).resolves.toMatchObject({ ok: false })
  })

  test('clears the retry guard after the installer cannot start', async () => {
    const subject = setup()
    subject.spawn.mockImplementationOnce(() => { throw new Error('EACCES') })
    await expect(subject.installer.install('codex')).resolves.toMatchObject({ ok: false })
    const retry = subject.installer.install('codex')
    subject.children[0]!.emit('close', 0, null)
    await expect(retry).resolves.toMatchObject({ ok: true })
  })

  test('handles an asynchronous spawn error without waiting for the timeout', async () => {
    const subject = setup()
    const running = subject.installer.install('codex')
    subject.children[0]!.emit('error', new Error('ENOENT'))
    subject.children[0]!.emit('close', -2, null)
    await expect(running).resolves.toMatchObject({ ok: false, message: expect.stringContaining('ENOENT') })
    expect(subject.progress.filter((event) => event.done)).toHaveLength(1)
  })

  test('provider installations keep their own progress and retry guards', async () => {
    const subject = setup()
    const providers: AgentProvider[] = ['codex', 'claude-code']
    const running = providers.map((provider) => subject.installer.install(provider))
    subject.children.forEach((child) => { child.emit('close', 0, null) })
    expect(await Promise.all(running)).toEqual([
      expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })
    ])
    expect(subject.progress.filter((event) => event.done).map((event) => event.provider)).toEqual(providers)
  })
})
