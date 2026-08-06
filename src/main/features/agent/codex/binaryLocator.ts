/** Locates the Codex CLI for GUI-launched Electron processes. */

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import type { AgentAvailability } from '../../../../shared/types/agent-events'
import {
  AgentUnavailableError,
  type BinaryLocator,
  type LocatedBinary
} from '../binaryLocator'
import {
  isWindows,
  joinPath,
  splitPath,
  type Platform
} from '../platform'

const execFileAsync = promisify(execFile)
const EXEC_TIMEOUT_MS = 10_000

export interface CodexBinaryLocatorDeps {
  configuredPath?: () => string | undefined
  exec?: (
    file: string,
    args: string[]
  ) => Promise<{ stdout: string; stderr: string }>
  platform?: Platform
  env?: NodeJS.ProcessEnv
}

function fileNames(platform: Platform): string[] {
  return isWindows(platform)
    ? ['codex.cmd', 'codex.exe', 'codex.bat']
    : ['codex']
}

function knownDirs(
  platform: Platform,
  env: NodeJS.ProcessEnv
): string[] {
  if (isWindows(platform)) {
    const appData = env['APPDATA']
    return appData === undefined || appData === ''
      ? []
      : [joinPath(platform, appData, 'npm')]
  }
  return [
    joinPath(platform, homedir(), '.local', 'bin'),
    joinPath(platform, homedir(), '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ]
}

function parseVersion(output: string): string | null {
  const match = /(?:codex-cli\s+)?(\d+\.\d+\.\d+)/u.exec(output)
  return match?.[1] ?? null
}

function authStatus(output: string): {
  loggedIn: boolean
  subscriptionType?: string
} {
  const line = output
    .split('\n')
    .map((part) => part.trim())
    .find((part) => /^Logged in using /iu.test(part))
  if (line === undefined) {
    return { loggedIn: false }
  }
  const subscriptionType = line.replace(/^Logged in using /iu, '').trim()
  return subscriptionType === ''
    ? { loggedIn: true }
    : { loggedIn: true, subscriptionType }
}

export function createCodexBinaryLocator(
  deps: CodexBinaryLocatorDeps = {}
): BinaryLocator {
  const exec =
    deps.exec ??
    (async (file: string, args: string[]) =>
      execFileAsync(file, args, { timeout: EXEC_TIMEOUT_MS }))
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env

  let cachedBinary: LocatedBinary | null = null
  let cachedShellPath: string | null | undefined

  async function loginShellPath(): Promise<string | null> {
    if (cachedShellPath !== undefined) {
      return cachedShellPath
    }
    if (isWindows(platform)) {
      const inherited = env['PATH'] ?? env['Path'] ?? null
      cachedShellPath = inherited === null || inherited === '' ? null : inherited
      return cachedShellPath
    }
    try {
      const { stdout } = await exec('/bin/zsh', ['-lic', 'echo -n "$PATH"'])
      cachedShellPath = stdout.trim() || null
    } catch {
      cachedShellPath = null
    }
    return cachedShellPath
  }

  async function candidates(): Promise<string[]> {
    const result: string[] = []
    const push = (path: string): void => {
      if (path !== '' && !result.includes(path)) {
        result.push(path)
      }
    }
    push(deps.configuredPath?.() ?? '')
    for (const dir of knownDirs(platform, env)) {
      for (const name of fileNames(platform)) {
        push(joinPath(platform, dir, name))
      }
    }
    const shellPath = await loginShellPath()
    if (shellPath !== null) {
      for (const dir of splitPath(shellPath, platform)) {
        for (const name of fileNames(platform)) {
          push(joinPath(platform, dir, name))
        }
      }
    }
    return result
  }

  async function locate(): Promise<LocatedBinary> {
    if (cachedBinary !== null) {
      return cachedBinary
    }
    for (const path of await candidates()) {
      try {
        const { stdout, stderr } = await exec(path, ['--version'])
        const version = parseVersion(`${stdout}\n${stderr}`)
        if (version !== null) {
          cachedBinary = { path, version }
          return cachedBinary
        }
      } catch {
        // Try the next well-known/PATH candidate.
      }
    }
    throw new AgentUnavailableError(
      'not-installed',
      isWindows(platform)
        ? 'Codex CLI를 찾지 못했습니다. %APPDATA%\\npm과 PATH를 확인했습니다.'
        : 'Codex CLI를 찾지 못했습니다. npm 설치 경로와 로그인 셸 PATH를 확인했습니다.'
    )
  }

  async function availability(): Promise<AgentAvailability> {
    let binary: LocatedBinary
    try {
      binary = await locate()
    } catch {
      return { installed: false, loggedIn: false }
    }
    const result: AgentAvailability = {
      installed: true,
      version: binary.version,
      loggedIn: false
    }
    try {
      // `codex login status` writes its human-readable status to stderr in
      // 0.146.0, so parse both streams and trust its successful exit status.
      const { stdout, stderr } = await exec(binary.path, ['login', 'status'])
      const auth = authStatus(`${stdout}\n${stderr}`)
      result.loggedIn = auth.loggedIn
      if (auth.subscriptionType !== undefined) {
        result.subscriptionType = auth.subscriptionType
      }
    } catch {
      result.loggedIn = false
    }
    return result
  }

  return {
    locate,
    availability,
    loginShellPath,
    reset() {
      cachedBinary = null
      cachedShellPath = undefined
    }
  }
}
