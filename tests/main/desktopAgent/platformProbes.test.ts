import { describe, expect, it, vi } from 'vitest'
import {
  frontmostMac,
  frontmostWin,
  parseForegroundWindowJson,
  parseLsappinfo
} from '../../../src/main/features/desktopAgent/platformProbes'

describe('parseLsappinfo', () => {
  it('parses the name and pid fields from a real lsappinfo-shaped record', () => {
    expect(
      parseLsappinfo(`
        "ASN"=ASN:0x0-0x1234:
        "name"="Safari"
        "pid"=123
      `)
    ).toEqual({ appName: 'Safari', pid: 123 })
  })

  it('returns null for broken input', () => {
    expect(parseLsappinfo('ASN:0x0-0x1234: no fields')).toBeNull()
  })
})

describe('parseForegroundWindowJson', () => {
  it('parses PowerShell JSON output', () => {
    expect(
      parseForegroundWindowJson(
        '{"appName":"chrome","windowTitle":"강의실","pid":456}'
      )
    ).toEqual({ appName: 'chrome', windowTitle: '강의실', pid: 456 })
  })

  it('normalizes an empty title and invalid pid', () => {
    expect(
      parseForegroundWindowJson(
        '{"appName":"explorer","windowTitle":"","pid":"bad"}'
      )
    ).toEqual({ appName: 'explorer', windowTitle: null, pid: null })
  })

  it('returns null for broken input', () => {
    expect(parseForegroundWindowJson('{broken')).toBeNull()
  })
})

describe('frontmost OS probes', () => {
  it('resolves the front ASN with exactly two lsappinfo calls', async () => {
    const exec = vi
      .fn<(cmd: string, args: string[]) => Promise<string>>()
      .mockResolvedValueOnce('ASN:0x0-0x1234:')
      .mockResolvedValueOnce('"name"="Safari"\n"pid"=123')

    await expect(frontmostMac(exec)).resolves.toEqual({
      appName: 'Safari',
      windowTitle: null,
      pid: 123
    })
    expect(exec.mock.calls).toEqual([
      ['lsappinfo', ['front']],
      ['lsappinfo', ['info', '-only', 'name,pid', 'ASN:0x0-0x1234:']]
    ])
  })

  it('never throws when the macOS probe fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('missing')
    })
    await expect(frontmostMac(exec)).resolves.toBeNull()
  })

  it('uses one no-profile PowerShell call on Windows', async () => {
    const exec = vi.fn(async () =>
      '{"appName":"Code","windowTitle":"lecture.ts","pid":789}'
    )

    await expect(frontmostWin(exec)).resolves.toEqual({
      appName: 'Code',
      windowTitle: 'lecture.ts',
      pid: 789
    })
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0]?.[0]).toBe('powershell')
    expect(exec.mock.calls[0]?.[1]).toContain('-NoProfile')
    expect(exec.mock.calls[0]?.[1].join(' ')).toContain('GetForegroundWindow')
  })
})
