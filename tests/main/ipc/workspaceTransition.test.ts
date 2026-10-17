import { expect, test, vi } from 'vitest'
import { createWorkspaceTransitions, type TransitionTarget } from '../../../src/main/ipc/workspaceTransition'
function fixture(count = 2, timeoutMs = 1000) {
  const targets = Array.from({ length: count }, (_, id) => {
    let unavailable = () => {}
    return { id, prepare: vi.fn(), release: vi.fn(), onUnavailable: (callback: () => void) => { unavailable = callback; return vi.fn() }, disappear: () => unavailable() }
  })
  return { targets, transitions: createWorkspaceTransitions(() => targets as TransitionTarget[], timeoutMs) }
}
test('every window must acknowledge its own request before the protected operation starts', async () => {
  const { targets, transitions } = fixture()
  const action = vi.fn(async () => 'finished')
  const result = transitions.run(action)
  const requestId = targets[0].prepare.mock.calls[0][0]
  expect(transitions.acknowledge(99, requestId, true)).toBe(false)
  expect(transitions.acknowledge(0, 'stale-request', true)).toBe(false)
  transitions.acknowledge(0, requestId, true)
  await Promise.resolve()
  expect(action).not.toHaveBeenCalled()
  transitions.acknowledge(1, requestId, true)
  expect(await result).toBe('finished')
  expect(action).toHaveBeenCalledOnce()
  targets.forEach(target => expect(target.release).toHaveBeenCalledWith(requestId))
  expect(transitions.committing()).toBe(false)
})
test('failed saves, closed windows and missing acknowledgements abort before mutating anything', async () => {
  for (const reason of ['failure', 'closed', 'timeout']) {
    const { targets, transitions } = fixture(1, 10)
    const action = vi.fn()
    const result = transitions.run(action)
    const requestId = targets[0].prepare.mock.calls[0][0]
    if (reason === 'failure') transitions.acknowledge(0, requestId, false)
    if (reason === 'closed') targets[0].disappear()
    await expect(result).rejects.toThrow()
    expect(action).not.toHaveBeenCalled()
    expect(targets[0].release).toHaveBeenCalledWith(requestId)
  }
})
test('concurrent transitions are rejected and restart success stays locked until cancellation', async () => {
  const { targets, transitions } = fixture(1)
  const result = transitions.run(async () => true, value => value)
  const requestId = targets[0].prepare.mock.calls[0][0]
  await expect(transitions.run(vi.fn())).rejects.toThrow('진행 중')
  transitions.acknowledge(0, requestId, true)
  await result
  expect(transitions.committing()).toBe(true)
  expect(targets[0].release).not.toHaveBeenCalled()
  transitions.release()
  expect(transitions.committing()).toBe(false)
  expect(targets[0].release).toHaveBeenCalledWith(requestId)
})
test('a failed protected operation releases all previously saved windows', async () => {
  const { targets, transitions } = fixture(1)
  const result = transitions.run(async () => { throw new Error('disk-full') })
  transitions.acknowledge(0, targets[0].prepare.mock.calls[0][0], true)
  await expect(result).rejects.toThrow('disk-full')
  expect(targets[0].release).toHaveBeenCalledOnce()
})
