import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ descriptors: vi.fn(), flush: vi.fn(), layout: vi.fn() }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ retainedTabDescriptors: mocks.descriptors, useWorkspaceStore: { getState: () => ({ flushPendingSave: mocks.layout }) } }))
vi.mock('../../../src/renderer/src/features/notes/noteSessionRegistry', () => ({ flushOpenNoteSession: mocks.flush }))
import { prepareUpdateInstall } from '../../../src/renderer/src/features/updates/prepareUpdateInstall'

beforeEach(() => { vi.clearAllMocks(); mocks.flush.mockResolvedValue({ result: { status: 'saved' } }) })
const note = (courseId: string, relPath: string) => ({ kind: 'note', payload: { courseId, relPath } })

test('awaits every unique resource across active and moved hidden placements before flushing layout', async () => {
  mocks.descriptors.mockReturnValue([note('source', 'a.md'), note('source', 'a.md'), note('hidden', 'b.md'), { kind: 'browser', payload: {} }])
  let saved!: () => void
  mocks.flush.mockImplementationOnce(() => new Promise(resolve => { saved = () => resolve({ result: { status: 'saved' } }) }))
  const pending = prepareUpdateInstall()
  expect(mocks.flush).toHaveBeenCalledWith({ courseId: 'source', relPath: 'a.md' })
  expect(mocks.layout).not.toHaveBeenCalled()
  saved(); await pending
  expect(mocks.flush).toHaveBeenCalledTimes(2)
  expect(mocks.flush).toHaveBeenLastCalledWith({ courseId: 'hidden', relPath: 'b.md' })
  expect(mocks.layout).toHaveBeenCalledOnce()
})

test.each(['conflict', 'error', 'unavailable'])('blocks restart on an open note %s without claiming the layout was saved', async status => {
  mocks.descriptors.mockReturnValue([note('source', 'a.md')])
  mocks.flush.mockResolvedValue({ result: { status } })
  await expect(prepareUpdateInstall()).rejects.toThrow('필기를 저장하지 못해 다시 시작하지 않았어요')
  expect(mocks.layout).not.toHaveBeenCalled()
})

test('a restored note with no live editor has no unsaved content to flush', async () => {
  mocks.descriptors.mockReturnValue([note('old', 'saved.md')]); mocks.flush.mockResolvedValue(null)
  await prepareUpdateInstall()
  expect(mocks.layout).toHaveBeenCalledOnce()
})
