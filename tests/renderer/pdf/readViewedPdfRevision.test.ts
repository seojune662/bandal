import { beforeEach, expect, test, vi } from 'vitest'
import { readViewedPdfRevision } from '../../../src/renderer/src/features/pdf/readViewedPdfRevision'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
beforeEach(() => invoke.mockReset())
test('old viewers retain rows without issuing a stale read after a rewrite', async () => {
  invoke.mockResolvedValue({ documentRevision: 'new' })
  const read = vi.fn()
  expect(await readViewedPdfRevision('course', 'note.pdf', 'old', read)).toBeUndefined()
  expect(read).not.toHaveBeenCalled()
})
test('a revision change racing the read is expected while other failures remain visible', async () => {
  invoke.mockResolvedValue({ documentRevision: 'old' })
  expect(await readViewedPdfRevision('course', 'note.pdf', 'old', async () => { throw new Error('PDF 원본이 기존 필기와 다릅니다. 원본 보존') })).toBeUndefined()
  await expect(readViewedPdfRevision('course', 'note.pdf', 'old', async () => { throw new Error('Disk failed') })).rejects.toThrow('Disk failed')
})
test('unchanged and legacy viewers read their content normally', async () => {
  invoke.mockResolvedValue({ documentRevision: 'old' })
  expect(await readViewedPdfRevision('course', 'note.pdf', 'old', async () => ['ink'])).toEqual(['ink'])
  invoke.mockClear()
  expect(await readViewedPdfRevision('course', 'note.pdf', undefined, async () => ['legacy'])).toEqual(['legacy'])
  expect(invoke).not.toHaveBeenCalled()
})
