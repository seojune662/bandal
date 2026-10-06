import { afterEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { probeModels } from '../../../src/main/features/agent/claude/modelProbe'
import { killProcessTree } from '../../../src/main/features/agent/platform'
vi.mock('../../../src/main/features/agent/platform', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/main/features/agent/platform')>(), killProcessTree: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
function fixture(reply: boolean) {
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }) as ChildProcess
  child.stdin!.on('data', chunk => { const request = JSON.parse(String(chunk)); if (reply) queueMicrotask(() => child.stdout!.emit('data', Buffer.from(JSON.stringify({ type: 'control_response', response: { request_id: request.request_id, subtype: 'success', response: { models: [{ value: 'sonnet', displayName: 'Sonnet' }] } } }) + '\n'))) })
  const spawnImpl = vi.fn(() => child)
  return { child, spawnImpl }
}
test('successful model discovery uses a process group and releases its streams and timer', async () => {
  vi.useFakeTimers(); const f = fixture(true)
  const models = await probeModels({ binaryPath: '/bin/claude', spawnImpl: f.spawnImpl })
  expect(models[0]?.value).toBe('sonnet')
  expect(f.spawnImpl.mock.calls[0]?.[2]).toMatchObject({ detached: true })
  expect(f.child.stdin!.writableEnded).toBe(true)
  expect(killProcessTree).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10000)
  expect(killProcessTree).toHaveBeenCalledTimes(1)
})
test('timed out model discovery also kills the group and closes stdin', async () => {
  vi.useFakeTimers(); const f = fixture(false)
  const result = probeModels({ binaryPath: '/bin/claude', spawnImpl: f.spawnImpl, timeoutMs: 100 })
  await vi.advanceTimersByTimeAsync(100)
  expect(await result).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'default' })]))
  expect(f.child.stdin!.writableEnded).toBe(true)
  expect(killProcessTree).toHaveBeenCalledWith(12345, 'SIGKILL')
})
