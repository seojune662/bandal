/** Provider CLI installers, invoked only by the explicit setup-card click. */

import { spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { AgentInstallProgress } from '../../../shared/ipc/events'
import type { AgentProvider } from '../../../shared/types/agent-events'
import { createBinaryLocator, type BinaryLocator } from './binaryLocator'
import { createCodexBinaryLocator } from './codex/binaryLocator'
import {
  killProcessTree,
  LOGIN_SHELL_PATH_ARGS,
  nvmBinDirs,
  spawnClaude,
  stripShellBanner
} from './platform'

export const CLAUDE_INSTALL_COMMAND =
  'curl -fsSL https://claude.ai/install.sh | bash'
export const CODEX_INSTALL_COMMAND = 'npm install -g @openai/codex'
export const AGENT_INSTALL_TIMEOUT_MS = 5 * 60 * 1000

function loginShellPathSync(): string | null {
  if (process.platform === 'win32') {
    return process.env['PATH'] ?? process.env['Path'] ?? null
  }
  const result = spawnSync('/bin/zsh', [...LOGIN_SHELL_PATH_ARGS], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000
  })
  const path = result.status === 0 ? stripShellBanner(result.stdout) : ''
  return path !== '' ? path : (process.env['PATH'] ?? null)
}

function resolveNpmSync(): string | null {
  if (process.platform === 'win32') {
    const found = spawnSync('where.exe', ['npm'], {
      encoding: 'utf8',
      windowsHide: true
    })
    return found.status === 0
      ? (found.stdout.split(/\r?\n/u).find((line) => line.trim() !== '')?.trim() ?? null)
      : null
  }

  // Electron launched from Finder has launchd's minimal PATH. Ask the same
  // login shell used by the binary locators so an nvm/homebrew npm is found.
  // NUL sentinel + stripShellBanner: rc-file banners print BEFORE our output,
  // and taking the first line here once turned ASCII art into "the npm path".
  const found = spawnSync(
    '/bin/zsh',
    ['-lic', 'printf "\\0%s" "$(command -v npm)"'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000
    }
  )
  if (found.status === 0) {
    const npmPath = stripShellBanner(found.stdout)
    if (npmPath.startsWith('/')) return npmPath
  }
  // Login shell failed or npm is not on its PATH — probe nvm installs directly.
  for (const dir of nvmBinDirs()) {
    const candidate = `${dir}/npm`
    if (existsSync(candidate)) return candidate
  }
  const inherited = spawnSync('npm', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000
  })
  return inherited.status === 0 ? 'npm' : null
}

function forwardLines(
  child: ChildProcess,
  provider: AgentProvider,
  broadcast: (progress: AgentInstallProgress) => void
): () => void {
  const carries = new Map<'stdout' | 'stderr', string>([
    ['stdout', ''],
    ['stderr', '']
  ])

  const listen = (kind: 'stdout' | 'stderr'): void => {
    child[kind]?.on('data', (chunk: Buffer) => {
      const combined = `${carries.get(kind) ?? ''}${chunk.toString('utf8')}`
      const lines = combined.split(/\r?\n/u)
      carries.set(kind, lines.pop() ?? '')
      for (const line of lines) {
        broadcast({ provider, line, done: false, ok: false })
      }
    })
  }
  listen('stdout')
  listen('stderr')

  return () => {
    for (const kind of ['stdout', 'stderr'] as const) {
      const tail = carries.get(kind) ?? ''
      if (tail !== '') {
        broadcast({ provider, line: tail, done: false, ok: false })
      }
      carries.set(kind, '')
    }
  }
}

async function verifyInstalled(locator: BinaryLocator): Promise<boolean> {
  locator.reset()
  try {
    await locator.locate()
    return true
  } catch {
    return false
  }
}

/**
 * Creates the installer IPC implementation.
 *
 * Contract: `install()` must only be called after the renderer has displayed
 * `commandFor()` verbatim and the user clicked 설치. It mutates the user's
 * machine, cannot be cancelled once started, and is forcibly timed out after
 * five minutes so a broken installer can never wait forever.
 */
export function createAgentInstaller(deps?: {
  broadcast?: (p: AgentInstallProgress) => void
}): {
  commandFor(provider: AgentProvider): { command: string; supported: boolean }
  install(provider: AgentProvider): Promise<{ ok: boolean; message: string }>
} {
  const broadcast = deps?.broadcast ?? (() => undefined)
  const claudeLocator = createBinaryLocator()
  const codexLocator = createCodexBinaryLocator()

  function commandFor(
    provider: AgentProvider
  ): { command: string; supported: boolean } {
    if (provider === 'claude-code') {
      return {
        command: CLAUDE_INSTALL_COMMAND,
        // The contracted installer is a POSIX curl|bash command.
        supported: process.platform !== 'win32'
      }
    }
    return {
      command: CODEX_INSTALL_COMMAND,
      supported: resolveNpmSync() !== null
    }
  }

  async function install(
    provider: AgentProvider
  ): Promise<{ ok: boolean; message: string }> {
    const announced = commandFor(provider)
    if (!announced.supported) {
      const message =
        provider === 'codex'
          ? 'npm을 찾지 못해 Codex를 자동 설치할 수 없습니다.'
          : '이 운영체제에서는 Claude Code 자동 설치 명령을 지원하지 않습니다.'
      broadcast({ provider, line: message, done: true, ok: false })
      return { ok: false, message }
    }

    let file: string
    let args: string[]
    if (provider === 'claude-code') {
      file = '/bin/sh'
      args = ['-c', CLAUDE_INSTALL_COMMAND]
    } else {
      const npmPath = resolveNpmSync()
      if (npmPath === null) {
        const message = 'npm을 찾지 못해 Codex를 자동 설치할 수 없습니다.'
        broadcast({ provider, line: message, done: true, ok: false })
        return { ok: false, message }
      }
      file = npmPath
      args = ['install', '-g', '@openai/codex']
    }

    let child: ChildProcess
    try {
      const env: NodeJS.ProcessEnv = { ...process.env }
      const loginPath = loginShellPathSync()
      if (loginPath !== null) {
        // npm installed by nvm uses `#!/usr/bin/env node`; its login-shell
        // PATH must reach both the npm shim and the matching node binary.
        env['PATH'] = loginPath
      }
      child = spawnClaude(file, args, {
        cwd: tmpdir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      const message = `설치 프로그램을 시작하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
      broadcast({ provider, line: message, done: true, ok: false })
      return { ok: false, message }
    }

    broadcast({
      provider,
      line: `실행: ${announced.command}`,
      done: false,
      ok: false
    })
    const flushLines = forwardLines(child, provider, broadcast)

    const processResult = await new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
      error?: Error
      timedOut: boolean
    }>((resolve) => {
      let settled = false
      const finish = (result: {
        code: number | null
        signal: NodeJS.Signals | null
        error?: Error
        timedOut: boolean
      }): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        flushLines()
        resolve(result)
      }
      const timer = setTimeout(() => {
        if (child.pid !== undefined) {
          killProcessTree(child.pid, 'SIGKILL')
        }
        finish({ code: null, signal: 'SIGKILL', timedOut: true })
      }, AGENT_INSTALL_TIMEOUT_MS)
      timer.unref()

      child.once('error', (error) =>
        finish({ code: null, signal: null, error, timedOut: false })
      )
      child.once('close', (code, signal) =>
        finish({ code, signal, timedOut: false })
      )
    })

    let ok = false
    let message: string
    if (processResult.timedOut) {
      message = '설치가 5분 안에 끝나지 않아 중단했습니다.'
    } else if (processResult.error !== undefined) {
      message = `설치 중 오류가 발생했습니다: ${processResult.error.message}`
    } else if (processResult.code !== 0) {
      message = `설치 명령이 실패했습니다 (코드 ${processResult.code ?? '없음'}, 신호 ${processResult.signal ?? '없음'}).`
    } else {
      ok = await verifyInstalled(
        provider === 'claude-code' ? claudeLocator : codexLocator
      )
      message = ok
        ? `${provider === 'claude-code' ? 'Claude Code' : 'Codex'} 설치를 확인했습니다.`
        : '설치 명령은 끝났지만 새 CLI를 PATH에서 찾지 못했습니다.'
    }

    broadcast({ provider, line: message, done: true, ok })
    return { ok, message }
  }

  return { commandFor, install }
}
