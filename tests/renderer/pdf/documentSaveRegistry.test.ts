import { expect, test, vi } from 'vitest'
import { flushDocumentSaves, registerDocumentSave } from '../../../src/renderer/src/features/documents/saveRegistry'

test('PDF export waits for every duplicate session without blocking on other documents', async () => {
  const ref = { courseId: 'course', relPath: 'lecture.pdf' }
  let finish!: () => void
  const first = vi.fn(async () => {})
  const second = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const unrelated = vi.fn(async () => { throw new Error('Another file cannot save') })
  const cleanups = [registerDocumentSave(first, ref), registerDocumentSave(second, ref),
    registerDocumentSave(unrelated, { ...ref, courseId: 'different' }), registerDocumentSave(unrelated)]
  try {
    const done = vi.fn()
    const pending = flushDocumentSaves(ref).then(done)
    await Promise.resolve()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(unrelated).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()
    finish()
    await pending
    expect(done).toHaveBeenCalledOnce()
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

test('a failed save in another view of this PDF stops export and unregistered views stop participating', async () => {
  const ref = { courseId: 'course', relPath: 'lecture.pdf' }
  const remove = registerDocumentSave(async () => { throw new Error('Unsaved ink') }, ref)
  try { await expect(flushDocumentSaves(ref)).rejects.toThrow('Unsaved ink') }
  finally { remove() }
  await expect(flushDocumentSaves(ref)).resolves.toBeUndefined()
})

test('update installation still flushes every document and legacy save registration', async () => {
  const pdf = vi.fn(async () => {}), legacy = vi.fn(async () => {})
  const cleanups = [registerDocumentSave(pdf, { courseId: 'course', relPath: 'lecture.pdf' }), registerDocumentSave(legacy)]
  try {
    await flushDocumentSaves()
    expect(pdf).toHaveBeenCalledOnce()
    expect(legacy).toHaveBeenCalledOnce()
  } finally { cleanups.forEach(cleanup => cleanup()) }
})
