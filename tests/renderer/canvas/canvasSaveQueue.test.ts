import { expect, test, vi } from 'vitest'
import { createCanvasSaveQueue } from '../../../src/renderer/src/features/canvas/canvasSaveQueue'

function deferred() {
  let resolve!: () => void
  return { promise: new Promise<void>(yes => { resolve = yes }), resolve }
}
test('orders board writes and waits for all queued edits before export', async () => {
  const state = vi.fn()
  const queue = createCanvasSaveQueue(state)
  const saving = deferred()
  const second = vi.fn(async () => {})
  void queue.enqueue(['shape'], () => saving.promise)
  void queue.enqueue(['shape'], second)
  let flushed = false
  const flush = queue.flush().then(() => { flushed = true })
  await Promise.resolve()
  expect(second).not.toHaveBeenCalled()
  expect(flushed).toBe(false)
  saving.resolve()
  await flush
  expect(second).toHaveBeenCalledOnce()
  expect(state).toHaveBeenLastCalledWith({ pending: 0, error: null })
})
test('keeps a failed edit recoverable after a different shape succeeds', async () => {
  const state = vi.fn()
  const queue = createCanvasSaveQueue(state)
  const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
  await queue.enqueue(['a'], save)
  await queue.enqueue(['b'], async () => {})
  expect(state).toHaveBeenLastCalledWith({ pending: 0, error: 'disk full' })
  await expect(queue.flush()).rejects.toThrow('disk full')
  await queue.retry()
  expect(save).toHaveBeenCalledTimes(2)
  expect(state).toHaveBeenLastCalledWith({ pending: 0, error: null })
})
test('retries only the still-failed part of a delete without erasing a later restored shape', async () => {
  const queue = createCanvasSaveQueue(() => {})
  const remove = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
  await queue.enqueue(['a', 'b'], remove)
  await queue.enqueue(['b'], async () => {})
  await queue.retry()
  expect(remove.mock.calls.map(([keys]) => keys)).toEqual([['a', 'b'], ['a']])
})
test('does not repeat a failed old edit after a new complete shape has been saved', async () => {
  const queue = createCanvasSaveQueue(() => {})
  const old = vi.fn(async () => { throw new Error('failed') })
  await queue.enqueue(['a'], old)
  await queue.enqueue(['a'], async () => {})
  await queue.retry()
  expect(old).toHaveBeenCalledOnce()
})

test('waits for image preparation and the shape saves it adds before exporting', async () => {
  const state = vi.fn()
  const queue = createCanvasSaveQueue(state)
  const decoding = deferred(), saving = deferred()
  void queue.prepare(async () => {
    await decoding.promise
    void queue.enqueue(['image'], () => saving.promise)
  })
  let exported = false
  const exportReady = queue.flush().then(() => { exported = true })
  await Promise.resolve()
  expect(exported).toBe(false)
  decoding.resolve()
  await Promise.resolve(); await Promise.resolve()
  expect(exported).toBe(false)
  saving.resolve()
  await exportReady
  expect(state).toHaveBeenLastCalledWith({ pending: 0, error: null })
})
