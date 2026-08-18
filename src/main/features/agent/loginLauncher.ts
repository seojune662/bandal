/**
 * `agent:login` — opens a visible terminal preloaded with the provider's
 * login command.
 *
 * CLI login is an interactive OAuth flow that requires a real TTY, so it
 * cannot run headless inside the app. Instead of telling the student to "open
 * a terminal and type claude" (the old LoginCard), the app opens the terminal
 * for them. The command embeds the ABSOLUTE binary path the locator resolved,
 * quoted, so the terminal session does not depend on its own PATH — the exact
 * PATH gap that breaks GUI-launched detection would otherwise break login too.
 *
 * The command string is built ONLY from the locator's resolved path plus
 * constant suffixes — no user input is ever interpolated, which is why the
 * Windows `shell: true` branch below is acceptable.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import type { AgentProvider } from '../../../shared/types/agent-events'
import type { BinaryLocator } from './binaryLocator'
import type { Platform } from './platform'

export interface LoginLauncherDeps {
  claudeLocator: BinaryLocator
  codexLocator: BinaryLocator
  /** Injectable for tests — lets one OS exercise every branch. */
  platform?: Platform
  /** Injectable for tests — defaults to child_process.spawn. */
  spawnFn?: typeof nodeSpawn
}

export interface LoginLauncher {
  login(provider: AgentProvider): Promise<{ ok: boolean; message: string }>
}

/** The shell command typed into the opened terminal, absolute path quoted. */
export function loginShellCommand(
  provider: AgentProvider,
  binaryPath: string
): string {
  // `claude` with no args starts the interactive CLI, which runs the login
  // flow when logged out; codex has an explicit `login` subcommand.
  return provider === 'codex' ? `"${binaryPath}" login` : `"${binaryPath}"`
}

/** Resolves ok:true once the terminal-opening process actually spawned. */
function awaitSpawn(child: ReturnType<typeof nodeSpawn>): Promise<boolean> {
  return new Promise((resolve) => {
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

export function createLoginLauncher(deps: LoginLauncherDeps): LoginLauncher {
  const platform = deps.platform ?? process.platform
  const spawnFn = deps.spawnFn ?? nodeSpawn

  async function login(
    provider: AgentProvider
  ): Promise<{ ok: boolean; message: string }> {
    const locator =
      provider === 'codex' ? deps.codexLocator : deps.claudeLocator
    let binaryPath: string
    try {
      binaryPath = (await locator.locate()).path
    } catch (error) {
      return {
        ok: false,
        message: `CLI를 찾지 못해 로그인을 시작할 수 없습니다. 먼저 설치해 주세요. (${
          error instanceof Error ? error.message : String(error)
        })`
      }
    }

    const command = loginShellCommand(provider, binaryPath)

    if (platform === 'darwin') {
      // AppleScript string literal: escape backslashes then double quotes.
      const escaped = command.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')
      const child = spawnFn(
        'osascript',
        [
          '-e',
          `tell application "Terminal" to do script "${escaped}"`,
          '-e',
          'tell application "Terminal" to activate'
        ],
        { detached: true, stdio: 'ignore' }
      )
      const ok = await awaitSpawn(child)
      return ok
        ? { ok: true, message: '터미널을 열었습니다. 로그인 후 앱으로 돌아와 주세요.' }
        : {
            ok: false,
            message: `터미널을 열지 못했습니다. 터미널에서 직접 실행해 주세요: ${command}`
          }
    }

    if (platform === 'win32') {
      // `start` needs cmd.exe; shell:true is safe here because `command` is
      // locator path + constants only (see module doc — no user input).
      const child = spawnFn(`start "" cmd /k ${command}`, {
        shell: true,
        detached: true,
        stdio: 'ignore'
      })
      const ok = await awaitSpawn(child)
      return ok
        ? { ok: true, message: '명령 프롬프트를 열었습니다. 로그인 후 앱으로 돌아와 주세요.' }
        : {
            ok: false,
            message: `터미널을 열지 못했습니다. 명령 프롬프트에서 직접 실행해 주세요: ${command}`
          }
    }

    // Linux: best effort — the Debian alternatives name, present on most
    // desktop distros. Failure falls back to telling the user the command.
    const child = spawnFn(
      'x-terminal-emulator',
      ['-e', 'sh', '-c', `${command}; exec sh`],
      { detached: true, stdio: 'ignore' }
    )
    const ok = await awaitSpawn(child)
    return ok
      ? { ok: true, message: '터미널을 열었습니다. 로그인 후 앱으로 돌아와 주세요.' }
      : {
          ok: false,
          message: `터미널을 자동으로 열지 못했습니다. 터미널에서 직접 실행해 주세요: ${command}`
        }
  }

  return { login }
}
