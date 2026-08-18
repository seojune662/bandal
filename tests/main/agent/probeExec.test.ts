/**
 * probeExec — the Windows-safe replacement for `promisify(execFile)` probes.
 *
 * The .cmd-shim EINVAL failure itself can only reproduce on Windows, so these
 * tests pin the contract instead: execFile-compatible resolve/reject semantics,
 * the timeout kill, and the injectable spawn seam through which cross-spawn
 * (the Windows-safe implementation) is wired by default.
 */

import { describe, expect, test } from 'vitest'
import type { SpawnOptions } from 'node:child_process'
import crossSpawn from 'cross-spawn'
import {
  probeExec,
  type ProbeExecError
} from '../../../src/main/features/agent/platform'

describe('probeExec', () => {
  test('resolves stdout/stderr on exit 0, like execFile', async () => {
    const result = await probeExec('/bin/sh', [
      '-c',
      'echo out; echo err 1>&2'
    ])
    expect(result.stdout).toBe('out\n')
    expect(result.stderr).toBe('err\n')
  })

  test('rejects on non-zero exit with the exit code attached, like execFile', async () => {
    const failure = await probeExec('/bin/sh', [
      '-c',
      'echo boom 1>&2; exit 3'
    ]).then(
      () => null,
      (error: ProbeExecError) => error
    )
    expect(failure).not.toBeNull()
    expect(failure?.code).toBe(3)
    expect(failure?.stderr).toBe('boom\n')
  })

  test('rejects with a string code on spawn failure, like execFile', async () => {
    const failure = await probeExec('/nonexistent/definitely-missing', []).then(
      () => null,
      (error: NodeJS.ErrnoException) => error
    )
    expect(failure?.code).toBe('ENOENT')
  })

  test('kills a hung probe after the timeout', async () => {
    const startedAt = Date.now()
    const failure = await probeExec('/bin/sh', ['-c', 'sleep 30'], {
      timeoutMs: 200
    }).then(
      () => null,
      (error: ProbeExecError) => error
    )
    expect(failure?.code).toBe('ETIMEDOUT')
    // Killed by the timeout, not by sleep finishing.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  test('spawns through the injectable seam (cross-spawn by default)', async () => {
    const seen: Array<{ file: string; args: string[] }> = []
    const spy = ((
      file: string,
      args: readonly string[],
      opts: SpawnOptions
    ) => {
      seen.push({ file, args: [...args] })
      return crossSpawn(file, args, opts)
    }) as unknown as typeof crossSpawn

    await probeExec('/bin/echo', ['hello'], { spawnFn: spy })

    expect(seen).toEqual([{ file: '/bin/echo', args: ['hello'] }])
  })
})
