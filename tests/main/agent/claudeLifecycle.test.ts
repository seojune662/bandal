import { afterEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createClaudeCodeAdapter } from '../../../src/main/features/agent/claude/ClaudeCodeAdapter'
import { killProcessTree } from '../../../src/main/features/agent/platform'
import type { AgentEvent } from '../../../src/shared/types/agent-events'
vi.mock('../../../src/main/features/agent/platform', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/main/features/agent/platform')>(), killProcessTree: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
async function fixture() {
  const child = Object.assign(new EventEmitter(), { pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() }) as ChildProcess
  const adapter = createClaudeCodeAdapter({ locator: { locate: async () => ({ path: '/bin/claude', version: '2.1.222' }), availability: async () => ({ installed: true, loggedIn: true }), loginShellPath: async () => null, reset() {} }, spawnImpl: () => child })
  const session = await adapter.startSession({ courseId: 'course', cwd: '/tmp' })
  const events: AgentEvent[] = [], writes: any[] = []
  session.on(event => events.push(event))
  child.stdin!.on('data', chunk => writes.push(JSON.parse(String(chunk))))
  const send = (value: unknown): void => { child.stdout!.emit('data', Buffer.from(JSON.stringify(value) + '\n')) }
  return { child, session, events, writes, send }
}
test('a silent Claude turn times out once and closes its process', async () => {
  vi.useFakeTimers(); const f = await fixture(); f.session.sendMessage('test')
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
  expect(f.events.filter(event => event.type === 'error')).toEqual([expect.objectContaining({ fatal: true })])
  expect(f.session.closed).toBe(true)
  expect(killProcessTree).toHaveBeenCalledWith(12345, 'SIGTERM')
  f.child.emit('exit', 0, null)
})
test('approval waiting pauses the no-progress timeout and answering restarts it', async () => {
  vi.useFakeTimers(); const f = await fixture(); f.session.sendMessage('test')
  f.send({ type: 'control_request', request_id: 'approval', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: '/tmp/note.md' } } })
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
  expect(f.events.filter(event => event.type === 'error')).toHaveLength(0)
  f.session.respondPermission('approval', { behavior: 'allow' })
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
  expect(f.events.filter(event => event.type === 'error')).toHaveLength(1)
  f.child.emit('exit', 0, null)
})
test('ignored Claude interrupt denies approvals and closes an interrupted turn after five seconds', async () => {
  vi.useFakeTimers(); const f = await fixture(); f.session.sendMessage('test')
  f.send({ type: 'control_request', request_id: 'approval', request: { subtype: 'can_use_tool', tool_name: 'Write', input: {} } })
  f.session.cancel(); await vi.advanceTimersByTimeAsync(5000)
  expect(f.events.filter(event => event.type === 'turn-complete')).toEqual([expect.objectContaining({ stopReason: 'interrupted' })])
  expect(f.events.filter(event => event.type === 'error')).toHaveLength(0)
  expect(f.writes).toContainEqual(expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'approval', response: expect.objectContaining({ behavior: 'deny' }) }) }))
  expect(f.session.closed).toBe(true)
  f.child.emit('exit', 0, null)
})
test('a completed cancellation timer cannot kill a later Claude turn', async () => {
  vi.useFakeTimers(); const f = await fixture(); f.session.sendMessage('first'); f.session.cancel()
  f.send({ type: 'result', subtype: 'error_during_execution', terminal_reason: 'aborted_streaming' })
  f.session.sendMessage('second'); await vi.advanceTimersByTimeAsync(5000)
  expect(killProcessTree).not.toHaveBeenCalled()
  expect(() => f.session.sendMessage('overlap')).toThrow('진행 중')
  f.session.dispose(); f.child.emit('exit', 0, null)
})
