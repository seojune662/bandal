import { beforeEach, expect, test, vi } from 'vitest'
import { sendStudyMode } from '../../../src/renderer/src/features/chat/studyMode'
import { captureLauncherContext, EMPTY_LAUNCHER_CONTEXT } from '../../../src/renderer/src/features/launcher/launcherContext'
import { invoke } from '../../../src/renderer/src/lib/ipc'
import { flushOpenNoteSession } from '../../../src/renderer/src/features/notes/noteSessionRegistry'
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: vi.fn() }))
vi.mock('../../../src/renderer/src/features/launcher/launcherContext', () => ({ captureLauncherContext: vi.fn(), EMPTY_LAUNCHER_CONTEXT: { courseId: null, courseName: null, sourcePanelId: null, descriptor: null, material: null, binding: null, articleIds: [], wordIds: [], selection: '', browser: null, sourceUnavailable: false } }))
vi.mock('../../../src/renderer/src/features/notes/noteSessionRegistry', () => ({ flushOpenNoteSession: vi.fn(async () => null) }))
const workspace = { kind: 'project' as const, courseId: 'course-1', rootRelPath: 'Project' }
const ai = { provider: 'codex' as const, model: 'model-fixture', effort: null }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT }); vi.mocked(invoke).mockResolvedValue({} as never) })
test('current native article keeps its stable source IDs even when an export exists', async () => {
  vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT, courseId: workspace.courseId, descriptor: { kind: 'learning-resource', payload: { courseId: workspace.courseId, rootRelPath: workspace.rootRelPath, resource: { kind: 'article', id: 'article-one' } } }, savedMaterialRelPath: 'Project/Articles/one.md' })
  await sendStudyMode(workspace, 'conversation', 'quiz', '어려운 7문제', {}, ai)
  expect(invoke).toHaveBeenCalledWith('study:generate', expect.objectContaining({ binding: { courseId: workspace.courseId, rootRelPath: workspace.rootRelPath }, source: { kind: 'article', articleIds: ['article-one'], sourceCourseId: workspace.courseId }, conversation: expect.objectContaining({ content: '어려운 7문제' }) }))
})
test('explicit selected files override the current document while keeping every attachment in the request', async () => {
  vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT, courseId: workspace.courseId, material: { courseId: workspace.courseId, kind: 'note', title: 'Unrelated', relPath: 'unrelated.md' } })
  const context = { files: [{ name: 'first', relPath: 'Project/first.pdf' }, { name: 'second', relPath: 'Project/second.pdf' }] }
  await sendStudyMode(workspace, 'conversation', 'flashcards', '양쪽을 비교해줘', context, ai)
  expect(flushOpenNoteSession).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('study:generate', expect.objectContaining({ source: { kind: 'material', relPath: 'Project/first.pdf', sourceCourseId: workspace.courseId }, conversation: expect.objectContaining({ context }) }))
})
test('current PDF selection and page survive native generation', async () => {
  vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT, courseId: workspace.courseId, selection: 'selected paragraph', material: { courseId: workspace.courseId, kind: 'pdf', title: 'PDF', relPath: 'Project/document.pdf', page: 5 } })
  await sendStudyMode(workspace, 'conversation', 'quiz', '선택한 부분으로', {}, ai)
  expect(invoke).toHaveBeenCalledWith('study:generate', expect.objectContaining({ source: { kind: 'material', relPath: 'Project/document.pdf', sourceCourseId: workspace.courseId, selection: 'selected paragraph', page: 5 } }))
})
test('linked original material remains the source while project placement owns conversation and generated outputs', async () => {
  vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT, courseId: 'original-course', selection: 'original selection', material: { courseId: 'original-course', kind: 'pdf', title: 'Original', relPath: 'original.pdf', page: 4 } })
  for (const mode of ['quiz', 'flashcards'] as const) {
    await sendStudyMode(workspace, 'project-conversation', mode, '이 원본으로 만들어줘', {}, ai)
    expect(invoke).toHaveBeenLastCalledWith('study:generate', expect.objectContaining({ courseId: workspace.courseId, binding: { courseId: workspace.courseId, rootRelPath: workspace.rootRelPath }, source: { kind: 'material', relPath: 'original.pdf', sourceCourseId: 'original-course', selection: 'original selection', page: 4 }, conversation: expect.objectContaining({ sessionId: 'project-conversation', workspaceKey: 'project:["course-1","Project"]' }) }))
  }
  await sendStudyMode(workspace, 'project-conversation', 'exam-predictions', '예상 문제', {}, ai)
  expect(invoke).toHaveBeenLastCalledWith('study:run', expect.objectContaining({ courseId: workspace.courseId, sourceCourseId: 'original-course', relPath: 'original.pdf', selection: 'original selection', conversation: expect.objectContaining({ sessionId: 'project-conversation' }) }))
})
test('legacy exam routes the live browser URL without mixing in a project directory target', async () => {
  vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT, courseId: workspace.courseId, selection: 'browser quote', browser: { url: 'https://example.test/original', tabId: 'browser-one', title: 'Original' } })
  await sendStudyMode(workspace, 'conversation', 'exam-predictions', '서술형으로', {}, ai)
  expect(invoke).toHaveBeenCalledWith('study:run', expect.objectContaining({ relPath: null, browserTabId: 'browser-one', browserTabUrl: 'https://example.test/original', selection: 'browser quote', conversation: expect.objectContaining({ content: '서술형으로' }) }))
})
test('missing current material is reported before generation and keeps an excluded material out of source', async () => {
  vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT, sourceUnavailable: true })
  await expect(sendStudyMode(workspace, 'conversation', 'quiz', 'generate', {}, ai)).rejects.toThrow('원본')
  expect(invoke).not.toHaveBeenCalled()
  vi.mocked(captureLauncherContext).mockResolvedValue({ ...EMPTY_LAUNCHER_CONTEXT, courseId: workspace.courseId, material: { courseId: workspace.courseId, kind: 'pdf', title: 'Excluded', relPath: 'excluded.pdf' } })
  await expect(sendStudyMode(workspace, 'conversation', 'quiz', 'generate', { excludeCurrentMaterial: true }, ai)).rejects.toThrow('현재 자료를 제외')
  await expect(sendStudyMode(workspace, 'conversation', 'exam-predictions', 'generate', { excludeCurrentMaterial: true }, ai)).rejects.toThrow('현재 자료를 제외')
  expect(invoke).not.toHaveBeenCalled()
})
