import { beforeEach, expect, test, vi } from 'vitest'
import { createDefaultNoteTab, createMarkdownTab, createStudyTab } from '../../../src/renderer/src/app/tabCommands'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), load: vi.fn(), toast: vi.fn(), paper: vi.fn(), courseId: 'first' as string | null, surface: 'course' }))
vi.mock('../../../src/renderer/src/features/pdfNotes/NewNoteSheet', () => ({ openNewNoteSheet: mocks.paper }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: { getState: () => ({ selectedCourseId: mocks.courseId }) } }))
vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({ useMaterialsStore: { getState: () => ({ loadTree: mocks.load }) } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ surface: mocks.surface, openTab: mocks.open }) } }))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({ settingsSnapshot: () => ({ tabs: { markdownTitlePrefix: '필기', notePaper: 'grid', noteOrientation: 'landscape' } }) }))
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


test('the note command captures its course and pane before opening the paper sheet', async () => {
  const target = { courseId: 'first', groupId: 'bottom-right' }
  await createStudyTab('whiteboard', target)
  mocks.courseId = 'second'
  expect(mocks.paper).toHaveBeenCalledWith('first', target)
  expect(mocks.invoke).not.toHaveBeenCalled()
  expect(mocks.open).not.toHaveBeenCalled()
})

test('the note command needs an active course without an explicit pane', async () => {
  mocks.surface = 'learning-home'
  await createStudyTab('whiteboard')
  expect(mocks.paper).not.toHaveBeenCalled()
})

test('an asynchronous markdown keeps its captured pane when focus changes', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const target = { courseId: 'first', groupId: 'bottom-right' }
  const pending = createMarkdownTab('내용', target)
  mocks.courseId = 'second'
  resolve({ courseId: 'first', relPath: '내용.md' })
  await pending
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note' }), { target })
})


test('the keyboard note uses saved paper defaults without a creation dialog', async () => {
  mocks.invoke.mockResolvedValue({ relPath: '노트.pdf' })
  await createDefaultNoteTab()
  expect(mocks.invoke).toHaveBeenCalledWith('pdfNotes:create', { courseId: 'first', title: expect.stringMatching(/^노트 \d{4}-\d{2}-\d{2}$/), paper: 'grid', orientation: 'landscape' })
  expect(mocks.paper).not.toHaveBeenCalled()
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pdf', payload: { courseId: 'first', relPath: '노트.pdf' } }))
})

test('a keyboard note does not jump into another course after asynchronous creation', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = createDefaultNoteTab()
  mocks.courseId = 'second'
  resolve({ relPath: '노트.pdf' })
  await pending
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.load).toHaveBeenCalledWith('first', { refreshOnly: true })
})

test('failed keyboard note creation reports the error without a phantom tab', async () => {
  mocks.invoke.mockRejectedValue(new Error('disk full'))
  await createDefaultNoteTab()
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('다시 시도'), 'danger')
})
