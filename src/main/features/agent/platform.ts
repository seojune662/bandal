/**
 * The one place OS differences live for the agent runtime.
 *
 * Everything here exists because the Claude Code CLI is installed and executed
 * differently on Windows than on macOS/Linux:
 *
 * - **No login shell.** `zsh -lic 'echo $PATH'` is how we find a CLI the user
 *   installed via a shell rc file. Windows has no equivalent — the process
 *   environment already carries the machine + user PATH.
 * - **The binary is a shim, not an ELF/Mach-O.** npm installs `claude.cmd`;
 *   `CreateProcess` cannot execute a `.cmd`, so it needs `cmd.exe /c`. We use
 *   `cross-spawn` for this rather than `shell: true`, see `spawnClaude` below.
 * - **No process groups.** `process.kill(-pid)` is POSIX-only and throws
 *   `EINVAL` on Windows; killing the CLI's helper processes needs `taskkill /T`.
 *
 * Every function takes an injectable `platform` so both branches are testable
 * from a single OS.
 */

import { spawn as nodeSpawn, spawnSync, type ChildProcess } from 'node:child_process'
import { readdirSync } from 'node:fs'
import crossSpawn from 'cross-spawn'
import { homedir } from 'node:os'
import { posix as posixPath, win32 as win32Path } from 'node:path'

export type Platform = NodeJS.Platform

export function isWindows(platform: Platform = process.platform): boolean {
  return platform === 'win32'
}

/**
 * Joins path segments using the *requested* platform's separator.
 *
 * Plain `path.join` uses the host's separator, which would produce
 * `C:\tools/claude.cmd` when the Windows branch is exercised from macOS. Every
 * path this module builds goes through here so the branches stay honest under
 * test — and so a future Linux CI job tests the same code the students run.
 */
export function joinPath(platform: Platform, ...parts: string[]): string {
  return isWindows(platform)
    ? win32Path.join(...parts)
    : posixPath.join(...parts)
}

/**
 * File names to try for the CLI in each PATH directory.
 *
 * On Windows the executable extension is mandatory — `spawn('claude')` fails
 * even when `claude.cmd` sits right there, because `CreateProcess` does not
 * consult `PATHEXT`. `.cmd` comes first: that is what npm's global install
 * writes, and it is what `where claude` resolves to on a normal setup.
 */
export function claudeFileNames(platform: Platform = process.platform): string[] {
  return isWindows(platform)
    ? ['claude.cmd', 'claude.exe', 'claude.bat']
    : ['claude']
}

/**
 * Well-known install locations to probe before falling back to PATH.
 *
 * POSIX: the CLI's own installer writes `~/.local/bin/claude`.
 * Windows: npm global installs land in `%APPDATA%\npm`, and the native
 * installer uses `%LOCALAPPDATA%\Programs\claude`. Neither is guaranteed to be
 * on the PATH of a GUI-launched process, which is exactly the case for an app
 * started from the Start menu.
 */
export function wellKnownClaudeDirs(
  platform: Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (!isWindows(platform)) {
    return [joinPath(platform, homedir(), '.local', 'bin')]
  }
  const dirs: string[] = []
  const appData = env['APPDATA']
  if (appData !== undefined && appData !== '') {
    dirs.push(joinPath(platform, appData, 'npm'))
  }
  const localAppData = env['LOCALAPPDATA']
  if (localAppData !== undefined && localAppData !== '') {
    dirs.push(joinPath(platform, localAppData, 'Programs', 'claude'))
    dirs.push(joinPath(platform, localAppData, 'Programs', 'claude', 'bin'))
  }
  return dirs
}

/**
 * Login-shell PATH capture, banner-proof.
 *
 * `-i` is required: nvm/homebrew PATH setup commonly lives in `.zshrc`, which
 * only interactive shells read. But interactive rc files may also print to
 * stdout before our output (a `cat` banner on line 1 of `.zshrc` shipped a
 * real bug: the banner's first line was taken as the npm path → spawn ENOENT).
 * A NUL sentinel marks where the real value starts — nothing else in shell
 * output contains NUL, so everything before the LAST NUL is rc noise.
 */
export const LOGIN_SHELL_PATH_ARGS: readonly string[] = [
  '-lic',
  'printf "\\0%s" "$PATH"'
]

/** Drops any rc-file banner noise printed before the NUL sentinel. */
export function stripShellBanner(stdout: string): string {
  const idx = stdout.lastIndexOf('\u0000')
  return (idx === -1 ? stdout : stdout.slice(idx + 1)).trim()
}

/**
 * nvm keeps node installs (and their npm/npx/codex shims) out of well-known
 * prefixes entirely — `~/.nvm/versions/node/<v>/bin` only reaches PATH via
 * `.zshrc`. Probe those dirs directly so a corrupted login-shell PATH can't
 * hide an installed CLI. Newest version first.
 */
export function nvmBinDirs(
  platform: Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (isWindows(platform)) return []
  const nvmDir =
    env['NVM_DIR'] !== undefined && env['NVM_DIR'] !== ''
      ? env['NVM_DIR']
      : joinPath(platform, homedir(), '.nvm')
  const versionsDir = joinPath(platform, nvmDir, 'versions', 'node')
  const numeric = (version: string): number[] =>
    version
      .replace(/^v/u, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  try {
    return readdirSync(versionsDir)
      .sort((a, b) => {
        const [aMaj = 0, aMin = 0, aPat = 0] = numeric(a)
        const [bMaj = 0, bMin = 0, bPat = 0] = numeric(b)
        return bMaj - aMaj || bMin - aMin || bPat - aPat
      })
      .map((version) => joinPath(platform, versionsDir, version, 'bin'))
  } catch {
    return []
  }
}

/**
 * Splits a PATH-like string into directories.
 *
 * `path.delimiter` is `;` on Windows and `:` elsewhere — but this module may be
 * asked about the *other* platform in tests, so the separator is derived from
 * the requested platform rather than the host.
 */
export function splitPath(
  value: string,
  platform: Platform = process.platform
): string[] {
  const sep = isWindows(platform) ? win32Path.delimiter : posixPath.delimiter
  return value.split(sep).filter((dir) => dir !== '')
}

/**
 * Spawns the CLI.
 *
 * `cross-spawn` rather than `{ shell: true }` on purpose. `shell: true` hands
 * the joined argv to `cmd.exe` **unescaped**, and our argv is not all
 * constants: `--append-system-prompt` carries `buildStudyPrompt(...)`, which
 * interpolates the course name the student typed. A course named
 * `물리학 & calc.exe` would then execute `calc.exe`. cross-spawn instead
 * escapes each argument for `cmd.exe` and passes
 * `windowsVerbatimArguments`, which is the same approach npm's own CLI uses.
 *
 * On non-Windows cross-spawn delegates straight to `child_process.spawn`, so
 * the POSIX path is unchanged.
 */
export interface SpawnClaudeOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  /** Defaults to `['pipe', 'pipe', 'pipe']`. */
  stdio?: Array<'pipe' | 'ignore' | 'inherit'>
  /**
   * POSIX only: put the child in its own process group so teardown can signal
   * the CLI's helper processes too. Defaults to `true`. Forced off on Windows,
   * where `detached` pops a console window instead and `taskkill /T` handles
   * the tree.
   */
  detached?: boolean
  platform?: Platform
}

export function spawnClaude(
  file: string,
  args: string[],
  opts: SpawnClaudeOptions
): ChildProcess {
  const platform = opts.platform ?? process.platform
  const windows = isWindows(platform)
  const spawnFn = windows ? crossSpawn : nodeSpawn
  return spawnFn(file, args, {
    cwd: opts.cwd,
    env: opts.env,
    detached: windows ? false : (opts.detached ?? true),
    // Suppresses the console window that `.cmd` shims flash on Windows.
    windowsHide: true,
    stdio: opts.stdio ?? ['pipe', 'pipe', 'pipe']
  })
}

/**
 * Kills a spawned CLI **and its descendants**.
 *
 * The CLI spawns helper processes, so killing only the direct child leaves
 * orphans holding the course folder open — on Windows that also blocks the
 * NSIS updater from replacing files.
 *
 * Returns nothing and never throws: every caller is teardown code (including
 * `process.on('exit')`), where an already-dead process is the normal case.
 */
export function killProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  platform: Platform = process.platform
): void {
  try {
    if (isWindows(platform)) {
      // No signals on Windows. /T = tree, /F = force. Synchronous so it is
      // usable from an exit handler, where async work never runs.
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      return
    }
    // Negative pid = "the whole process group", POSIX only.
    process.kill(-pid, signal)
  } catch {
    // Already gone, or the group vanished between check and signal.
  }
}
