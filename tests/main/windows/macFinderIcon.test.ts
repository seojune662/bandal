import { beforeEach, describe, expect, test, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({ access: vi.fn() }))

vi.mock('node:fs/promises', () => ({ access: fsMocks.access }))

import {
  createFinderIconApplier,
  resolveAppBundlePath
} from '../../../src/main/windows/macFinderIcon'

describe('resolveAppBundlePath', () => {
  test('walks an executable path up to its app bundle', () => {
    expect(
      resolveAppBundlePath('/Applications/Bandal.app/Contents/MacOS/Bandal')
    ).toBe('/Applications/Bandal.app')
  })

  test('rejects executables outside an app bundle', () => {
    expect(resolveAppBundlePath('/usr/local/bin/bandal')).toBeNull()
  })
})

describe('createFinderIconApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.access.mockResolvedValue(undefined)
  })

  test('quietly skips a bundle that is not writable', async () => {
    fsMocks.access.mockRejectedValueOnce(new Error('EACCES'))
    const exec = vi.fn()
    const applier = createFinderIconApplier({
      appBundlePath: '/Applications/Bandal.app',
      exec
    })

    await expect(applier.apply('/icons/icon-512.png')).resolves.toBeUndefined()

    expect(exec).not.toHaveBeenCalled()
  })

  test('applies a PNG with osascript JavaScript for Automation', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: 'true\n', stderr: '' }))
    const applier = createFinderIconApplier({
      appBundlePath: '/Applications/Bandal.app',
      exec
    })

    await applier.apply('/tmp/lavender icon.png')

    expect(exec).toHaveBeenCalledOnce()
    const [command, args] = exec.mock.calls[0]!
    expect(command).toBe('osascript')
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e'])
    expect(args[3]).toContain("ObjC.import('AppKit')")
    expect(args[3]).toContain(
      '$.NSImage.alloc.initWithContentsOfFile("/tmp/lavender icon.png")'
    )
    expect(args[3]).toContain('"/Applications/Bandal.app"')
  })

  test('passes an empty Objective-C value to clear Finder metadata', async () => {
    const exec = vi.fn(async () => ({ code: 0, stdout: 'true', stderr: '' }))
    const applier = createFinderIconApplier({
      appBundlePath: '/Applications/Bandal.app',
      exec
    })

    await applier.apply(null)

    expect(exec.mock.calls[0]?.[1][3]).toContain('const img = $()')
  })

  test('warns when Finder does not report success', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const exec = vi.fn(async () => ({
      code: 1,
      stdout: 'false\n',
      stderr: 'not allowed'
    }))
    const applier = createFinderIconApplier({
      appBundlePath: '/Applications/Bandal.app',
      exec
    })

    await applier.apply('/tmp/icon.png')

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[finder-icon\]/),
      'not allowed'
    )
  })
})
