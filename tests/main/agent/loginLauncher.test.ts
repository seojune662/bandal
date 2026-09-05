/**
 * agent:login — opens a terminal preloaded with the provider's login command.
 * All spawns go through an injected seam; no real terminal ever opens here.
 */

import { EventEmitter } from 'node:events'
import type { spawn as nodeSpawn } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import {
  createLoginLauncher,
  loginShellCommand
} from '../../../src/main/features/agent/loginLauncher'
import type { BinaryLocator } from '../../../src/main/features/agent/binaryLocator'
import type { AgentProvider } from '../../../src/shared/types/agent-events'

function fakeLocator(path: string | null): BinaryLocator {
  return {
    locate: async () => {
      if (path === null) {
        throw new Error('CLI not found')
      }
      return { path, version: '9.9.9' }
    },
    availability: async () => ({ installed: path !== null, loggedIn: false }),
    loginShellPath: async () => null,
    reset: () => undefined
  }
}

function locatorSet(
  claudePath: string | null,
  codexPath: string | null,
  geminiPath: string | null = null
): Record<AgentProvider, BinaryLocator> {
  return {
    'claude-code': fakeLocator(claudePath),
    codex: fakeLocator(codexPath),
    gemini: fakeLocator(geminiPath)
  }
}

interface SpawnCall {
  file: string
  args: string[]
  opts: Record<string, unknown> | undefined
}

/** Fake child that immediately reports either 'spawn' or 'error'. */
function fakeSpawnFn(
  calls: SpawnCall[],
  outcome: 'spawn' | 'error'
): typeof nodeSpawn {
  return ((file: string, argsOrOpts?: unknown, maybeOpts?: unknown) => {
    const args = Array.isArray(argsOrOpts) ? (argsOrOpts as string[]) : []
    const opts = (Array.isArray(argsOrOpts) ? maybeOpts : argsOrOpts) as
      | Record<string, unknown>
      | undefined
    calls.push({ file, args, opts })
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = () => undefined
    process.nextTick(() => {
      child.emit(outcome, outcome === 'error' ? new Error('ENOENT') : undefined)
    })
    return child
  }) as unknown as typeof nodeSpawn
}

describe('loginShellCommand', () => {
  test('quotes the absolute path so the terminal ignores its own PATH', () => {
    expect(loginShellCommand('claude-code', '/opt/some dir/claude')).toBe(
      '"/opt/some dir/claude"'
    )
    expect(loginShellCommand('codex', '/usr/local/bin/codex')).toBe(
      '"/usr/local/bin/codex" login'
    )
    expect(loginShellCommand('gemini', '/usr/local/bin/gemini')).toBe(
      '"/usr/local/bin/gemini"'
    )
  })
})

describe('login launcher', () => {
  test('macOS: opens Terminal via osascript with the quoted claude path', async () => {
    const calls: SpawnCall[] = []
    const launcher = createLoginLauncher({
      locators: locatorSet('/opt/homebrew/bin/claude', null),
      platform: 'darwin',
      spawnFn: fakeSpawnFn(calls, 'spawn')
    })

    const result = await launcher.login('claude-code')

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.file).toBe('osascript')
    const script = calls[0]?.args.join(' ') ?? ''
    expect(script).toContain('tell application "Terminal" to do script')
    expect(script).toContain('/opt/homebrew/bin/claude')
    expect(script).toContain('activate')
  })

  test('macOS: codex opens with the login subcommand', async () => {
    const calls: SpawnCall[] = []
    const launcher = createLoginLauncher({
      locators: locatorSet(null, '/usr/local/bin/codex'),
      platform: 'darwin',
      spawnFn: fakeSpawnFn(calls, 'spawn')
    })

    const result = await launcher.login('codex')

    expect(result.ok).toBe(true)
    expect(calls[0]?.args.join(' ')).toContain('codex\\" login')
  })

  test('macOS: gemini opens the interactive CLI directly', async () => {
    const calls: SpawnCall[] = []
    const launcher = createLoginLauncher({
      locators: locatorSet(null, null, '/usr/local/bin/gemini'),
      platform: 'darwin',
      spawnFn: fakeSpawnFn(calls, 'spawn')
    })

    const result = await launcher.login('gemini')

    expect(result.ok).toBe(true)
    expect(calls[0]?.args.join(' ')).toContain('/usr/local/bin/gemini')
    expect(calls[0]?.args.join(' ')).not.toContain('gemini\\" login')
  })

  test('windows: uses start cmd /k with the quoted path', async () => {
    const calls: SpawnCall[] = []
    const launcher = createLoginLauncher({
      locators: locatorSet('C:\\Users\\s\\.local\\bin\\claude.exe', null),
      platform: 'win32',
      spawnFn: fakeSpawnFn(calls, 'spawn')
    })

    const result = await launcher.login('claude-code')

    expect(result.ok).toBe(true)
    expect(calls[0]?.file).toBe(
      'start "" cmd /k "C:\\Users\\s\\.local\\bin\\claude.exe"'
    )
    expect(calls[0]?.opts).toMatchObject({ shell: true, detached: true })
  })

  test('linux: falls back to a copy-paste message when no terminal opens', async () => {
    const calls: SpawnCall[] = []
    const launcher = createLoginLauncher({
      locators: locatorSet('/usr/local/bin/claude', null),
      platform: 'linux',
      spawnFn: fakeSpawnFn(calls, 'error')
    })

    const result = await launcher.login('claude-code')

    expect(result.ok).toBe(false)
    // 사용자가 직접 붙여넣을 수 있게 명령을 그대로 알려 준다.
    expect(result.message).toContain('"/usr/local/bin/claude"')
  })

  test('fails with an install hint when the CLI cannot be located', async () => {
    const calls: SpawnCall[] = []
    const launcher = createLoginLauncher({
      locators: locatorSet(null, null),
      platform: 'darwin',
      spawnFn: fakeSpawnFn(calls, 'spawn')
    })

    const result = await launcher.login('claude-code')

    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
    expect(result.message).toContain('설치')
  })
})
