import { beforeEach, expect, test, vi } from 'vitest'
import { createMarkdownTab, createStudyTab } from '../../../src/renderer/src/app/tabCommands'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), load: vi.fn(), toast: vi.fn(), courseId: 'first' as string | null, surface: 'course' }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: { getState: () => ({ selectedCourseId: mocks.courseId }) } }))
vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({ useMaterialsStore: { getState: () => ({ loadTree: mocks.load }) } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ surface: mocks.surface, openTab: mocks.open }) } }))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({ settingsSnapshot: () => ({ tabs: { markdownTitlePrefix: '필기' } }) }))
beforeEach(() => { vi.clearAllMocks(); mocks.courseId = 'first'; mocks.surface = 'course' })

test('creating a note cannot attach the old course note to a newly selected workspace', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = createMarkdownTab('내용')
  mocks.courseId = 'second'
  resolve({ courseId: 'first', relPath: '내용.md' })
  await pending
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.load).toHaveBeenCalledWith('first', { refreshOnly: true })
  expect(mocks.toast).toHaveBeenCalled()
})

test('a failed new note command gives actionable feedback', async () => {
  mocks.invoke.mockRejectedValue(new Error('disk full'))
  await createMarkdownTab('내용')
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('다시 시도'), 'danger')
  expect(mocks.open).not.toHaveBeenCalled()
})


test.each(['other-course', 'learning-home'])('a delayed whiteboard creation preserves the current %s surface', async destination => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = createStudyTab('whiteboard')
  if (destination === 'other-course') mocks.courseId = 'second'
  else mocks.surface = 'learning-home'
  resolve({ id: 'new-board' })
  await pending
  expect(mocks.invoke).toHaveBeenCalledWith('canvas:create', { courseId: 'first' })
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith('원래 과목에 새 화이트보드를 만들었어요.')
})

test('a whiteboard still opens when its original course remains active', async () => {
  mocks.invoke.mockResolvedValue({ id: 'new-board' })
  await createStudyTab('whiteboard')
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'whiteboard', payload: { courseId: 'first', boardId: 'new-board' } })
})
