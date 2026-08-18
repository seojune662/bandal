/**
 * Platform-branch tests for the agent runtime.
 *
 * These exist because the Windows branches can never run on the dev machine
 * (macOS) nor in CI's Linux job — the only way they get exercised before a
 * student hits them is by injecting `platform`.
 */

import { describe, expect, it } from 'vitest'
import {
  augmentedPathEnv,
  claudeFileNames,
  isWindows,
  splitPath,
  wellKnownClaudeDirs,
  windowsCliInstallDirs
} from '../../../src/main/features/agent/platform'
import { createBinaryLocator } from '../../../src/main/features/agent/binaryLocator'

/** Locator tests fabricate paths, so the existsSync prefilter must pass all. */
const anyFile = { fileExists: () => true }

describe('isWindows', () => {
  it('is true only for win32', () => {
    expect(isWindows('win32')).toBe(true)
    expect(isWindows('darwin')).toBe(false)
    expect(isWindows('linux')).toBe(false)
  })
})

describe('claudeFileNames', () => {
  it('returns the bare name on POSIX', () => {
    expect(claudeFileNames('darwin')).toEqual(['claude'])
  })

  it('requires an executable extension on Windows, .cmd first', () => {
    // CreateProcess does not consult PATHEXT, so a bare 'claude' never runs
    // even when claude.cmd is present. npm's global install writes the .cmd.
    const names = claudeFileNames('win32')
    expect(names[0]).toBe('claude.cmd')
    expect(names).toContain('claude.exe')
    expect(names).not.toContain('claude')
  })
})

describe('splitPath', () => {
  it('splits on : for POSIX', () => {
    expect(splitPath('/usr/bin:/usr/local/bin', 'darwin')).toEqual([
      '/usr/bin',
      '/usr/local/bin'
    ])
  })

  it('splits on ; for Windows', () => {
    expect(splitPath('C:\\Windows;C:\\tools', 'win32')).toEqual([
      'C:\\Windows',
      'C:\\tools'
    ])
  })

  it('drops empty segments', () => {
    expect(splitPath('/usr/bin::/opt/bin:', 'darwin')).toEqual([
      '/usr/bin',
      '/opt/bin'
    ])
  })
})

describe('wellKnownClaudeDirs', () => {
  it('uses ~/.local/bin on POSIX', () => {
    const dirs = wellKnownClaudeDirs('darwin', {})
    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toMatch(/\.local[/\\]bin$/)
  })

  it('uses the npm and Programs dirs on Windows', () => {
    const dirs = wellKnownClaudeDirs('win32', {
      APPDATA: 'C:\\Users\\s\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\s\\AppData\\Local'
    })
    expect(dirs).toContain('C:\\Users\\s\\AppData\\Roaming\\npm')
    expect(dirs.some((d) => d.includes('Programs'))).toBe(true)
  })

  it('skips dirs whose env var is absent rather than emitting "undefined\\npm"', () => {
    expect(wellKnownClaudeDirs('win32', {})).toEqual([])
  })

  it('sweeps the native-installer, Scoop, Volta and pnpm dirs on Windows', () => {
    const dirs = wellKnownClaudeDirs('win32', {
      USERPROFILE: 'C:\\Users\\s',
      LOCALAPPDATA: 'C:\\Users\\s\\AppData\\Local'
    })
    expect(dirs).toContain('C:\\Users\\s\\.local\\bin')
    expect(dirs).toContain('C:\\Users\\s\\scoop\\shims')
    expect(dirs).toContain('C:\\Users\\s\\AppData\\Local\\Volta\\bin')
    expect(dirs).toContain('C:\\Users\\s\\AppData\\Local\\pnpm')
  })
})

describe('windowsCliInstallDirs', () => {
  it('emits nothing when the env vars are absent', () => {
    expect(windowsCliInstallDirs('win32', {})).toEqual([])
  })
})

describe('augmentedPathEnv', () => {
  it('keeps exactly one canonical PATH key on Windows', () => {
    const env = augmentedPathEnv(
      'C:\\tools\\claude.cmd',
      null,
      { Path: 'C:\\Windows' },
      'win32'
    )
    // A leftover `Path` next to our `PATH` makes the child's PATH
    // non-deterministic — Windows env names are case-insensitive.
    expect(env['Path']).toBeUndefined()
    expect(env['PATH']).toContain('C:\\tools')
    expect(env['PATH']).toContain('C:\\Windows')
  })

  it('leaves POSIX envs untouched apart from PATH', () => {
    const env = augmentedPathEnv(
      '/opt/homebrew/bin/claude',
      '/custom/bin',
      { PATH: '/usr/bin', HOME: '/Users/s' },
      'darwin'
    )
    expect(env['PATH']).toBe('/opt/homebrew/bin:/custom/bin:/usr/bin')
    expect(env['HOME']).toBe('/Users/s')
  })
})

describe('binaryLocator — Windows branch', () => {
  const VERSION_OK = 'claude 2.1.222'

  it('reads PATH from the environment instead of shelling out to zsh', async () => {
    const calls: string[] = []
    const locator = createBinaryLocator({
      ...anyFile,
      platform: 'win32',
      env: { PATH: 'C:\\tools' },
      exec: async (file) => {
        calls.push(file)
        if (file === 'C:\\tools\\claude.cmd') {
          return { stdout: VERSION_OK, stderr: '' }
        }
        throw new Error('not found')
      }
    })

    const binary = await locator.locate()

    expect(binary.path).toBe('C:\\tools\\claude.cmd')
    // The whole point: no /bin/zsh on Windows.
    expect(calls).not.toContain('/bin/zsh')
    expect(await locator.loginShellPath()).toBe('C:\\tools')
  })

  it('falls back to the Path spelling Windows sometimes uses', async () => {
    const locator = createBinaryLocator({
      ...anyFile,
      platform: 'win32',
      env: { Path: 'C:\\tools' },
      exec: async (file) =>
        file === 'C:\\tools\\claude.exe'
          ? { stdout: VERSION_OK, stderr: '' }
          : Promise.reject(new Error('not found'))
    })

    expect((await locator.locate()).path).toBe('C:\\tools\\claude.exe')
  })

  it('reports the Windows locations in the not-installed message', async () => {
    const locator = createBinaryLocator({
      ...anyFile,
      platform: 'win32',
      env: { PATH: 'C:\\tools' },
      exec: async () => Promise.reject(new Error('not found'))
    })

    await expect(locator.locate()).rejects.toThrow(/APPDATA/)
  })

  it('probes %APPDATA%\\npm before PATH', async () => {
    const tried: string[] = []
    const locator = createBinaryLocator({
      ...anyFile,
      platform: 'win32',
      env: { APPDATA: 'C:\\Roaming', PATH: 'C:\\tools' },
      exec: async (file) => {
        tried.push(file)
        return file === 'C:\\Roaming\\npm\\claude.cmd'
          ? { stdout: VERSION_OK, stderr: '' }
          : Promise.reject(new Error('not found'))
      }
    })

    expect((await locator.locate()).path).toBe('C:\\Roaming\\npm\\claude.cmd')
    expect(tried[0]).toBe('C:\\Roaming\\npm\\claude.cmd')
  })
})

describe('binaryLocator — POSIX branch is unchanged', () => {
  it('still asks a login shell for PATH', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const locator = createBinaryLocator({
      ...anyFile,
      platform: 'darwin',
      env: {},
      exec: async (file, args) => {
        calls.push({ file, args })
        if (file === '/bin/zsh') {
          return { stdout: '/opt/homebrew/bin', stderr: '' }
        }
        if (file === '/opt/homebrew/bin/claude') {
          return { stdout: 'claude 2.1.222', stderr: '' }
        }
        throw new Error('not found')
      }
    })

    const binary = await locator.locate()

    expect(binary.path).toBe('/opt/homebrew/bin/claude')
    expect(calls[0]).toEqual({ file: '/bin/zsh', args: ['-lic', 'printf "\\0%s" "$PATH"'] })
  })

  it('prefers a configured path over everything else', async () => {
    const locator = createBinaryLocator({
      ...anyFile,
      platform: 'darwin',
      env: {},
      configuredPath: () => '/custom/claude',
      exec: async (file) =>
        file === '/custom/claude'
          ? { stdout: 'claude 2.1.222', stderr: '' }
          : Promise.reject(new Error('not found'))
    })

    expect((await locator.locate()).path).toBe('/custom/claude')
  })
})

describe('binaryLocator — availability keeps the failure reason', () => {
  it('reports version-too-old as installed with code and found version', async () => {
    const locator = createBinaryLocator({
      ...anyFile,
      platform: 'darwin',
      env: {},
      configuredPath: () => '/custom/claude',
      exec: async (file) =>
        file === '/custom/claude'
          ? { stdout: 'claude 1.0.9', stderr: '' }
          : Promise.reject(new Error('not found'))
    })

    const availability = await locator.availability()

    // The CLI IS there — the UI must offer an update, not an install.
    expect(availability.installed).toBe(true)
    expect(availability.loggedIn).toBe(false)
    expect(availability.version).toBe('1.0.9')
    expect(availability.code).toBe('version-too-old')
    expect(availability.reason).toMatch(/1\.0\.9/)
  })

  it('propagates the not-installed reason instead of a bare false', async () => {
    const locator = createBinaryLocator({
      fileExists: () => false,
      platform: 'darwin',
      env: {},
      exec: async (file) => {
        if (file === '/bin/zsh') {
          return { stdout: '/opt/homebrew/bin', stderr: '' }
        }
        throw new Error('should not probe: nothing exists')
      }
    })

    const availability = await locator.availability()

    expect(availability).toMatchObject({
      installed: false,
      loggedIn: false,
      code: 'not-installed'
    })
    expect(availability.reason).toMatch(/not found/)
  })

  it('skips candidates the fileExists prefilter rejects', async () => {
    const probed: string[] = []
    const locator = createBinaryLocator({
      fileExists: (path) => path === '/opt/homebrew/bin/claude',
      platform: 'darwin',
      env: {},
      exec: async (file) => {
        if (file === '/bin/zsh') {
          return { stdout: '/missing/bin:/opt/homebrew/bin', stderr: '' }
        }
        probed.push(file)
        return { stdout: 'claude 2.1.222', stderr: '' }
      }
    })

    const binary = await locator.locate()

    expect(binary.path).toBe('/opt/homebrew/bin/claude')
    // /missing/bin/claude never reached a spawn.
    expect(probed).toEqual(['/opt/homebrew/bin/claude'])
  })
})
