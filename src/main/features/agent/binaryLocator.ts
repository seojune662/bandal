/**
 * Locates the user's own Claude Code CLI binary and answers
 * `agent:availability`. Resolution order: configured path → ~/.local/bin/claude
 * → login-shell PATH (`zsh -lic 'command -v claude'`). Results are cached.
 */

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join, delimiter, dirname } from 'node:path'
import { promisify } from 'node:util'
import type { AgentAvailability, AgentErrorCode } from '../../../shared/types/agent-events'

const execFileAsync = promisify(execFile)

const EXEC_TIMEOUT_MS = 10_000
export const MIN_CLI_VERSION = { major: 2, minor: 1 }

export class AgentUnavailableError extends Error {
  readonly code: AgentErrorCode

  constructor(code: AgentErrorCode, message: string) {
    super(message)
    this.name = 'AgentUnavailableError'
    this.code = code
  }
}

export interface LocatedBinary {
  path: string
  version: string
}

export interface BinaryLocator {
  /** Resolved CLI binary (cached). Throws AgentUnavailableError. */
  locate(): Promise<LocatedBinary>
  /** Availability summary for the renderer; never throws. */
  availability(): Promise<AgentAvailability>
  /** PATH from a login shell (cached), for child process env. */
  loginShellPath(): Promise<string | null>
  /** Drops caches (e.g. after the user installs the CLI). */
  reset(): void
}

export interface BinaryLocatorDeps {
  /** Optional user-configured absolute path to the claude binary. */
  configuredPath?: () => string | undefined
  /** Injectable exec for tests. */
  exec?: (
    file: string,
    args: string[]
  ) => Promise<{ stdout: string; stderr: string }>
}

function parseVersion(stdout: string): string | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(stdout)
  return match === null ? null : match[0]
}

export function isVersionSupported(version: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version)
  if (match === null) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major !== MIN_CLI_VERSION.major) {
    return major > MIN_CLI_VERSION.major
  }
  return minor >= MIN_CLI_VERSION.minor
}

interface AuthStatus {
  loggedIn: boolean
  subscriptionType?: string
}

function parseAuthStatus(stdout: string): AuthStatus {
  try {
    const start = stdout.indexOf('{')
    if (start < 0) {
      return { loggedIn: false }
    }
    const parsed: unknown = JSON.parse(stdout.slice(start))
    if (typeof parsed !== 'object' || parsed === null) {
      return { loggedIn: false }
    }
    const record = parsed as Record<string, unknown>
    const status: AuthStatus = { loggedIn: record['loggedIn'] === true }
    if (typeof record['subscriptionType'] === 'string') {
      status.subscriptionType = record['subscriptionType']
    }
    return status
  } catch {
    return { loggedIn: false }
  }
}

export function createBinaryLocator(deps: BinaryLocatorDeps = {}): BinaryLocator {
  const exec =
    deps.exec ??
    (async (file: string, args: string[]) =>
      execFileAsync(file, args, { timeout: EXEC_TIMEOUT_MS }))

  let cachedBinary: LocatedBinary | null = null
  let cachedShellPath: string | null | undefined

  async function tryVersion(path: string): Promise<string | null> {
    try {
      const { stdout } = await exec(path, ['--version'])
      return parseVersion(stdout)
    } catch {
      return null
    }
  }

  async function loginShellPath(): Promise<string | null> {
    if (cachedShellPath !== undefined) {
      return cachedShellPath
    }
    try {
      const { stdout } = await exec('/bin/zsh', ['-lic', 'echo -n "$PATH"'])
      const path = stdout.trim()
      cachedShellPath = path === '' ? null : path
    } catch {
      cachedShellPath = null
    }
    return cachedShellPath
  }

  async function candidates(): Promise<string[]> {
    const list: string[] = []
    const configured = deps.configuredPath?.()
    if (configured !== undefined && configured !== '') {
      list.push(configured)
    }
    list.push(join(homedir(), '.local', 'bin', 'claude'))
    const shellPath = await loginShellPath()
    if (shellPath !== null) {
      for (const dir of shellPath.split(delimiter)) {
        if (dir !== '' && !list.includes(join(dir, 'claude'))) {
          list.push(join(dir, 'claude'))
        }
      }
    }
    return list
  }

  async function locate(): Promise<LocatedBinary> {
    if (cachedBinary !== null) {
      return cachedBinary
    }
    let sawBinary = false
    let badVersion: string | null = null
    for (const path of await candidates()) {
      const version = await tryVersion(path)
      if (version === null) {
        continue
      }
      sawBinary = true
      if (isVersionSupported(version)) {
        cachedBinary = { path, version }
        return cachedBinary
      }
      badVersion = version
    }
    if (sawBinary) {
      throw new AgentUnavailableError(
        'version-too-old',
        `Claude Code ${badVersion ?? '?'} found, but ${MIN_CLI_VERSION.major}.${MIN_CLI_VERSION.minor}+ is required`
      )
    }
    throw new AgentUnavailableError(
      'not-installed',
      'Claude Code CLI not found (checked configured path, ~/.local/bin and the login-shell PATH)'
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
      const { stdout } = await exec(binary.path, ['auth', 'status', '--json'])
      const auth = parseAuthStatus(stdout)
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
    reset: () => {
      cachedBinary = null
      cachedShellPath = undefined
    }
  }
}

/** Directory of a located binary, useful for PATH augmentation. */
export function binaryDir(binary: LocatedBinary): string {
  return dirname(binary.path)
}
