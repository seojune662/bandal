import { describe, expect, test, vi } from 'vitest'
import { runThumbnailTask } from '../../../src/renderer/src/features/materials/preview/thumbnailQueue'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('global hover thumbnail queue', () => {
  test('limits active media jobs to two and removes an aborted waiting job', async () => {
    const first = deferred<number>()
    const second = deferred<number>()
    const skipped = vi.fn(async () => 3)
    const fourth = vi.fn(async () => 4)
    const cancel = new AbortController()
    const a = runThumbnailTask(new AbortController().signal, () => first.promise)
    const b = runThumbnailTask(new AbortController().signal, () => second.promise)
    const c = runThumbnailTask(cancel.signal, skipped)
    const rejected = expect(c).rejects.toThrow('row left')
    const d = runThumbnailTask(new AbortController().signal, fourth)
    expect(skipped).not.toHaveBeenCalled()
    expect(fourth).not.toHaveBeenCalled()
    cancel.abort(new Error('row left'))
    await rejected
    first.resolve(1)
    expect(await a).toBe(1)
    expect(await d).toBe(4)
    expect(skipped).not.toHaveBeenCalled()
    second.resolve(2)
    expect(await b).toBe(2)
  })

  test('holds a cancelled running slot through cleanup without cancelling another subscriber', async () => {
    const cleanup = deferred<string>()
    const independent = deferred<string>()
    const cancel = new AbortController()
    const a = runThumbnailTask(cancel.signal, () => cleanup.promise)
    const rejected = expect(a).rejects.toThrow('cancel one')
    const b = runThumbnailTask(new AbortController().signal, () => independent.promise)
    const next = vi.fn(async () => 'next')
    const c = runThumbnailTask(new AbortController().signal, next)
    cancel.abort(new Error('cancel one'))
    await rejected
    expect(next).not.toHaveBeenCalled()
    cleanup.resolve('cancelled cleanup finished')
    expect(await c).toBe('next')
    independent.resolve('other remains live')
    expect(await b).toBe('other remains live')
  })
})
