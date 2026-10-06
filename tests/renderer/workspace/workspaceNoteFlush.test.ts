import { expect, test, vi } from 'vitest'
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ retainedTabDescriptors: vi.fn(() => [{ kind: 'note', payload: { courseId: 'original', relPath: 'draft.md' } }]) }))
vi.mock('../../../src/renderer/src/features/notes/noteSessionRegistry', () => ({ flushOpenNoteSession: vi.fn() }))
import { flushOpenNoteSession } from '../../../src/renderer/src/features/notes/noteSessionRegistry'
import { flushWorkspaceNotes } from '../../../src/renderer/src/features/workspace/workspaceNoteFlush'

test('eviction flushes a moved note using its resource binding and refuses failed saves', async () => {
  vi.mocked(flushOpenNoteSession).mockResolvedValueOnce({ ref: { courseId: 'original', relPath: 'draft.md' }, result: { status: 'saved' } })
  expect(await flushWorkspaceNotes('placement')).toBe(true)
  expect(flushOpenNoteSession).toHaveBeenCalledWith({ courseId: 'original', relPath: 'draft.md' })
  vi.mocked(flushOpenNoteSession).mockResolvedValueOnce({ ref: { courseId: 'original', relPath: 'draft.md' }, result: { status: 'error', detail: 'disk full' } })
  expect(await flushWorkspaceNotes('placement')).toBe(false)
})
