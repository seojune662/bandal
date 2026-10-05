// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { executeFeatureAction, featureActionDisabledReason } from '../../../src/renderer/src/features/launcher/featureActions'
import { EMPTY_LAUNCHER_CONTEXT, type LauncherContext } from '../../../src/renderer/src/features/launcher/launcherContext'
import type { PackFeatureEntry, PluginCommandFeatureEntry } from '../../../src/renderer/src/features/launcher/featureInventory'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { registerDocumentContext } from '../../../src/renderer/src/features/agent/documentContext'
import { registerOpenNoteSession } from '../../../src/renderer/src/features/notes/noteSessionRegistry'
import * as learningNavigation from '../../../src/renderer/src/features/learning/learningNavigation'
import * as dialogs from '../../../src/renderer/src/features/learning/LearningDialogsHost'
import * as pluginCommands from '../../../src/renderer/src/features/plugins/pluginCommands'

const ai = { provider: 'codex' as const, model: 'real-model', effort: null }
const configured = { purpose: 'course-review', ai, binding: { courseId: 'course', rootRelPath: 'Reading/Science' }, articles: [], words: [] }
const binding = { courseId: 'course', rootRelPath: 'Reading/Science' }
const cleanups: Array<() => void> = []
function pack(overrides: Partial<PackFeatureEntry> = {}): PackFeatureEntry {
  return { kind: 'pack', id: 'pack:custom:quiz', packId: 'custom:quiz', label: 'Custom quiz', description: 'Quiz', source: 'user', enabled: true,
    unavailableReason: null, schemaVersion: 2, experience: 'quiz', worksOn: ['course', 'material', 'selection'], usesWeb: false,
    outputs: { dir: 'AI 학습자료', primary: 'Quiz' }, ...overrides }
}
function noteContext(): LauncherContext {
  return { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course', sourcePanelId: 'note-copy', selection: 'Unsaved chosen quote',
    material: { courseId: 'course', kind: 'note', title: 'note', relPath: 'note.md', unsaved: true } }
}
function adapter(invoke: unknown): void { setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter) }
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(learningNavigation, 'openLearning').mockImplementation(() => {}) })
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); setIpcAdapter(null); vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear() })

test('saving a selected note is awaited, and a conflict prevents any AI generation', async () => {
  const context = noteContext()
  cleanups.push(registerDocumentContext('note-copy', () => ({ ...context.material!, selection: context.selection })))
  cleanups.push(registerOpenNoteSession({ panelId: 'note-copy', ref: () => ({ courseId: 'course', relPath: 'note.md' }), retarget: () => {}, flush: async () => ({ status: 'conflict', detail: 'External edit' }) }))
  const invoke = vi.fn(async (channel: string) => channel === 'learning:list' ? { projects: [{ ...configured, linkedCourseId: 'course', updatedAt: 'now' }] } : configured); adapter(invoke)
  expect(await executeFeatureAction(pack(), context, 'selection')).toMatchObject({ status: 'failed', message: expect.stringContaining('External edit') })
  expect(invoke.mock.calls.some(call => call[0] === 'study:generate')).toBe(false)
})

test('a saved selection is generated in the chosen bound subfolder with its original custom pack', async () => {
  const context = noteContext()
  cleanups.push(registerDocumentContext('note-copy', () => ({ ...context.material!, selection: context.selection })))
  let finishSave!: () => void
  cleanups.push(registerOpenNoteSession({ panelId: 'note-copy', ref: () => ({ courseId: 'course', relPath: 'note.md' }), retarget: () => {}, flush: () => new Promise(resolve => { finishSave = () => resolve({ status: 'saved' }) }) }))
  const invoke = vi.fn(async (channel: string) => channel === 'learning:get' ? configured : { binding, runId: 'queued-run' }); adapter(invoke)
  const pending = executeFeatureAction(pack(), context, 'selection', { binding })
  await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'))
  expect(invoke.mock.calls.some(call => call[0] === 'study:generate')).toBe(false)
  finishSave()
  expect(await pending).toMatchObject({ status: 'started', runId: 'queued-run', binding })
  expect(invoke).toHaveBeenCalledWith('study:generate', { courseId: 'course', packId: 'custom:quiz', binding, source: { kind: 'material', relPath: 'note.md', selection: 'Unsaved chosen quote', sourceCourseId: 'course' } })
})

test('article and vocabulary generation keep their portable project binding and exact IDs', async () => {
  const project = { ...configured, articles: [{ id: 'article-b', status: 'reading', exportRelPath: '기사/b.md' }], words: [{ id: 'word-b' }], exports: [{ relPath: '단어장.md' }] }
  const invoke = vi.fn(async (channel: string) => channel === 'learning:get' ? project : { binding, runId: 'run' }); adapter(invoke)
  const article: LauncherContext = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course', binding, descriptor: { kind: 'learning', payload: { ...binding, view: 'reader', itemId: 'article-b' } }, articleIds: ['article-b'] }
  expect(await executeFeatureAction(pack(), article, 'material')).toMatchObject({ status: 'started' })
  expect(invoke).toHaveBeenLastCalledWith('study:generate', { courseId: 'course', packId: 'custom:quiz', binding, source: { kind: 'article', articleIds: ['article-b'], sourceCourseId: 'course' } })
  const vocabulary: LauncherContext = { ...article, descriptor: { kind: 'learning', payload: { ...binding, view: 'vocabulary' } }, articleIds: [], wordIds: ['word-b'] }
  expect(await executeFeatureAction(pack({ experience: 'flashcards' }), vocabulary, 'material')).toMatchObject({ status: 'started' })
  expect(invoke).toHaveBeenLastCalledWith('study:generate', { courseId: 'course', packId: 'custom:quiz', binding, source: { kind: 'vocabulary', wordIds: ['word-b'], sourceCourseId: 'course' } })
})

test('a browser quiz first stores the live source and generates from the verified saved article ID', async () => {
  const browser = { tabId: 'source-tab', url: 'https://example.com/current?utm_source=launcher#top', title: 'Current page' }
  const context: LauncherContext = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course', browser, material: { courseId: 'course', kind: 'browser', title: browser.title, browserTabId: browser.tabId, url: browser.url } }
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'learning:get') return configured
    if (channel === 'learning:addArticle') return { addedArticleId: 'verified-current', articles: [{ id: 'verified-current', sourceUrl: 'https://example.com/original-mirror' }, { id: 'unrelated', sourceUrl: 'https://example.com/other' }] }
    return { binding, runId: 'browser-quiz' }
  }); adapter(invoke)
  expect(await executeFeatureAction(pack(), context, 'material', { binding })).toMatchObject({ status: 'started', runId: 'browser-quiz' })
  expect(invoke.mock.calls.map(call => call[0])).toEqual(['learning:get', 'learning:addArticle', 'study:generate'])
  expect(invoke).toHaveBeenCalledWith('learning:addArticle', { binding, url: browser.url, tabId: 'source-tab', sourceCourseId: 'course' })
  expect(invoke).toHaveBeenLastCalledWith('study:generate', { courseId: 'course', packId: 'custom:quiz', binding, source: { kind: 'article', articleIds: ['verified-current'], sourceCourseId: 'course' } })
})

test('a browser import with no matching host article ID cannot generate from an unrelated article', async () => {
  const browser = { tabId: 'source-tab', url: 'https://example.com/current', title: 'Current page' }
  const context: LauncherContext = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course', browser, material: { courseId: 'course', kind: 'browser', title: browser.title, browserTabId: browser.tabId, url: browser.url } }
  const invoke = vi.fn(async (channel: string) => channel === 'learning:get' ? configured : ({ addedArticleId: 'missing', articles: [{ id: 'unrelated', sourceUrl: browser.url }] })); adapter(invoke)
  expect(await executeFeatureAction(pack(), context, 'material', { binding })).toMatchObject({ status: 'failed' })
  expect(invoke.mock.calls).toHaveLength(2)
  expect(invoke.mock.calls[1]?.[0]).toBe('learning:addArticle')
})

test('legacy dispatch is a generation request, retains follow-up metadata and never claims completion', async () => {
  const invoke = vi.fn(async () => ({ relPath: 'AI 학습자료/result.md' })); adapter(invoke)
  const context = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course', material: { courseId: 'course', kind: 'file', title: 'pdf', relPath: 'lecture.pdf' } }
  const result = await executeFeatureAction(pack({ schemaVersion: 1, experience: undefined } as unknown as Partial<PackFeatureEntry>), context, 'material', { followUp: true })
  expect(result).toMatchObject({ status: 'dispatched', courseId: 'course', relPath: 'AI 학습자료/result.md' })
  expect(result.message).not.toContain('만들었어요')
  expect(invoke).toHaveBeenCalledWith('study:run', { courseId: 'course', tool: 'custom:quiz', relPath: 'lecture.pdf', followUpOf: 'custom:quiz' })
})

test('English resumes the sole project, asks for a choice among projects, and preserves pack identity on creation', async () => {
  const english = pack({ experience: 'article-vocabulary' })
  const context = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course' }
  const create = vi.spyOn(dialogs, 'requestLearningCreation').mockImplementation(() => {})
  const invoke = vi.fn(async (channel: string) => channel === 'learning:list' ? { projects: [] } : {}); adapter(invoke)
  expect(await executeFeatureAction(english, context, 'course')).toMatchObject({ status: 'opened' })
  expect(create).toHaveBeenCalledWith(undefined, 'custom:quiz')
  invoke.mockImplementation(async (channel: string) => channel === 'learning:list' ? { projects: [{ ...configured, purpose: 'english-reading', readingSetupConfirmed: true, binding }, { ...configured, purpose: 'english-reading', readingSetupConfirmed: true, binding: { ...binding, rootRelPath: 'Second' } }] } : {})
  expect(await executeFeatureAction(english, context, 'course')).toMatchObject({ status: 'needs-project-picker', projects: expect.any(Array) })
  invoke.mockImplementation(async (channel: string) => channel === 'learning:list' ? { projects: [{ ...configured, purpose: 'english-reading', readingSetupConfirmed: true, binding }] } : { ...configured, purpose: 'english-reading', readingSetupConfirmed: true, name: 'Science', articles: [{ id: 'next', status: 'reading' }] })
  expect(await executeFeatureAction(english, context, 'course')).toMatchObject({ status: 'opened', binding })
  expect(learningNavigation.openLearning).toHaveBeenCalledWith(binding, 'reader', 'next')
  expect(invoke.mock.calls.map(call => call[0])).not.toContain('learning:create')
})

test('scope mismatch and a different learning-source binding cannot launch generation', async () => {
  const context = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course', material: { courseId: 'course', kind: 'file', title: 'pdf', relPath: 'lecture.pdf' } }
  expect(featureActionDisabledReason(pack({ worksOn: ['selection'] }), context, 'material')).not.toBeNull()
  const invoke = vi.fn(); adapter(invoke)
  expect(await executeFeatureAction(pack(), { ...context, binding, articleIds: ['article'] }, 'material', { binding: { ...binding, courseId: 'other' } })).toMatchObject({ status: 'failed', message: expect.stringContaining('저장된 학습 공간') })
  expect(invoke).not.toHaveBeenCalled()
})

test('a global command on course scope receives no implicit file target', async () => {
  const entry: PluginCommandFeatureEntry = { kind: 'plugin-command', id: 'plugin:test:count', pluginId: 'test', pluginName: 'Test', commandId: 'count', defaultChord: null, menuLocations: [], label: 'Count', description: '', source: 'extension', enabled: true, unavailableReason: null }
  const command = vi.spyOn(pluginCommands, 'runPluginCommand').mockResolvedValue()
  expect(await executeFeatureAction(entry, noteContext(), 'course')).toMatchObject({ status: 'completed' })
  expect(command).toHaveBeenCalledWith('test', 'count', undefined, { notify: false })
  expect(featureActionDisabledReason({ ...entry, menuLocations: ['editor'] }, { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course' }, 'material')).toContain('필기')
})
