/**
 * Platform-branch tests for the agent runtime.
 *
 * These exist because the Windows branches can never run on the dev machine
 * (macOS) nor in CI's Linux job — the only way they get exercised before a
 * student hits them is by injecting `platform`.
 */

import { describe, expect, it } from 'vitest'
import {
  claudeFileNames,
  isWindows,
  splitPath,
  wellKnownClaudeDirs
} from '../../../src/main/features/agent/platform'
import { createBinaryLocator } from '../../../src/main/features/agent/binaryLocator'

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
})

describe('binaryLocator — Windows branch', () => {
  const VERSION_OK = 'claude 2.1.222'

  it('reads PATH from the environment instead of shelling out to zsh', async () => {
    const calls: string[] = []
    const locator = createBinaryLocator({
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
      platform: 'win32',
      env: { PATH: 'C:\\tools' },
      exec: async () => Promise.reject(new Error('not found'))
    })

    await expect(locator.locate()).rejects.toThrow(/APPDATA/)
  })

  it('probes %APPDATA%\\npm before PATH', async () => {
    const tried: string[] = []
    const locator = createBinaryLocator({
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
