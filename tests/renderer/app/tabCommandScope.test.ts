import { beforeEach, expect, test, vi } from 'vitest'
import { createDefaultNoteTab, createMarkdownTab, createStudyTab } from '../../../src/renderer/src/app/tabCommands'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), load: vi.fn(), toast: vi.fn(), paper: vi.fn(), assistant: vi.fn(), afterTransition: vi.fn<(action: () => void) => void>(), courseId: 'first' as string | null, surface: 'course', windowId: 'main', groupId: 'captured-group' as string | undefined, projectRoot: null as string | null }))
vi.mock('../../../src/renderer/src/features/assistantPanel/assistantController', () => ({ openWorkspaceAssistant: mocks.assistant }))
vi.mock('../../../src/renderer/src/features/pdfNotes/NewNoteSheet', () => ({ openNewNoteSheet: mocks.paper }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: { getState: () => ({ selectedCourseId: mocks.courseId }) } }))
vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({ useMaterialsStore: { getState: () => ({ loadTree: mocks.load }) } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ workspaceApiForWindow: () => ({ activeGroup: mocks.groupId ? { id: mocks.groupId } : undefined }), useWorkspaceStore: { getState: () => ({ surface: mocks.surface, activeWindowId: mocks.windowId, activeWorkspace: mocks.courseId === null ? null : mocks.projectRoot === null ? { kind: 'course', courseId: mocks.courseId } : { kind: 'project', courseId: mocks.courseId, rootRelPath: mocks.projectRoot }, openTab: mocks.open, afterWorkspaceTransition: mocks.afterTransition }) } }))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({ settingsSnapshot: () => ({ tabs: { markdownTitlePrefix: '필기', notePaper: 'grid', noteOrientation: 'landscape' } }) }))
beforeEach(() => { vi.clearAllMocks(); mocks.afterTransition.mockImplementation(action => action()); mocks.courseId = 'first'; mocks.surface = 'course'; mocks.projectRoot = null; mocks.windowId = 'main'; mocks.groupId = 'captured-group' })

const originalTarget = { courseId: 'first', workspace: { kind: 'course', courseId: 'first' }, windowId: 'main', groupId: 'captured-group' }

test('the AI shortcut waits for navigation before choosing its workspace and creating a conversation', async () => {
  let finishTransition!: () => void
  mocks.afterTransition.mockImplementation(action => { finishTransition = action })
  await createStudyTab('chat')
  expect(mocks.assistant).not.toHaveBeenCalled()
  mocks.courseId = 'second'
  mocks.projectRoot = 'Reading'
  finishTransition()
  expect(mocks.assistant).toHaveBeenCalledExactlyOnceWith(
    { kind: 'project', courseId: 'second', rootRelPath: 'Reading' },
    { conversationId: expect.any(String) }
  )
  expect(mocks.open).not.toHaveBeenCalled()
})

test('an explicitly targeted AI command keeps its project while another workspace is selected', async () => {
  mocks.courseId = 'second'
  const workspace = { kind: 'project' as const, courseId: 'first', rootRelPath: 'Original' }
  await createStudyTab('chat', { courseId: 'first', workspace, windowId: 'original' })
  expect(mocks.afterTransition).not.toHaveBeenCalled()
  expect(mocks.assistant).toHaveBeenCalledExactlyOnceWith(workspace, { conversationId: expect.any(String) })
})

test('creating a note cannot attach the old course note to a newly selected workspace', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = createMarkdownTab('내용')
  mocks.courseId = 'second'
  resolve({ courseId: 'first', relPath: '내용.md' })
  await pending
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note' }), { target: originalTarget })
  expect(mocks.load).toHaveBeenCalledWith('first', { refreshOnly: true })
  expect(mocks.toast).not.toHaveBeenCalled()
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

test('the keyboard paper sheet captures its active workspace window before opening', async () => {
  await createStudyTab('whiteboard')
  expect(mocks.paper).toHaveBeenCalledWith('first', originalTarget)
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
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pdf', payload: { courseId: 'first', relPath: '노트.pdf' } }), { target: originalTarget })
})

test('a keyboard note does not jump into another course after asynchronous creation', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = createDefaultNoteTab()
  mocks.courseId = 'second'
  resolve({ relPath: '노트.pdf' })
  await pending
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pdf' }), { target: originalTarget })
  expect(mocks.load).toHaveBeenCalledWith('first', { refreshOnly: true })
})

test('failed keyboard note creation reports the error without a phantom tab', async () => {
  mocks.invoke.mockRejectedValue(new Error('disk full'))
  await createDefaultNoteTab()
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('다시 시도'), 'danger')
})


test('a project note keeps its captured root when another project in the same course opens', async () => {
  let resolve!: (value: unknown) => void
  mocks.projectRoot = 'projects/first'
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = createMarkdownTab('프로젝트 필기')
  expect(mocks.invoke).toHaveBeenCalledWith('notes:create', { courseId: 'first', dirRelPath: 'projects/first', title: '프로젝트 필기' })
  mocks.projectRoot = 'projects/second'
  resolve({ courseId: 'first', relPath: 'projects/first/프로젝트 필기.md' })
  await pending
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note' }), { target: { ...originalTarget, workspace: { kind: 'project', courseId: 'first', rootRelPath: 'projects/first' } } })
  expect(mocks.load).toHaveBeenCalledWith('first', { refreshOnly: true })
})

for (const create of [createMarkdownTab, createDefaultNoteTab]) test(`a pending ${create.name} cannot open in another window of the same workspace`, async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = create()
  mocks.windowId = 'second'
  resolve({ courseId: 'first', relPath: 'new.md' })
  await pending
  expect(mocks.open).toHaveBeenCalledWith(expect.anything(), { target: originalTarget })
  expect(mocks.toast).not.toHaveBeenCalled()
})

test('creating in an empty canvas keeps its original window without requiring a split group', async () => {
  mocks.groupId = undefined
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = createMarkdownTab('첫 필기')
  mocks.windowId = 'second'
  resolve({ courseId: 'first', relPath: '첫 필기.md' })
  await pending
  expect(mocks.open).toHaveBeenCalledWith(expect.anything(), { target: { courseId: 'first', workspace: { kind: 'course', courseId: 'first' }, windowId: 'main' } })
})
