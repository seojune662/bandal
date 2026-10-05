// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { LearningGenerationDialog, type LearningGenerationRequest } from '../../../src/renderer/src/features/learning/LearningGenerationDialog'
import { LearningDialogsHost } from '../../../src/renderer/src/features/learning/LearningDialogsHost'
import { requestFeatureAction, executeFeatureAction } from '../../../src/renderer/src/features/launcher/featureActions'
import { EMPTY_LAUNCHER_CONTEXT } from '../../../src/renderer/src/features/launcher/launcherContext'
import type { PackFeatureEntry } from '../../../src/renderer/src/features/launcher/featureInventory'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { registerDocumentContext } from '../../../src/renderer/src/features/agent/documentContext'
import * as navigation from '../../../src/renderer/src/features/learning/learningNavigation'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
const ai = { provider: 'gemini' as const, model: 'pro', effort: null }
const binding = { courseId: 'review', rootRelPath: '' }
const entry: PackFeatureEntry = { kind: 'pack', id: 'pack:quiz', packId: 'quiz', label: '퀴즈', description: '', enabled: true, source: 'builtin', unavailableReason: null, schemaVersion: 2, experience: 'quiz', worksOn: ['course', 'material', 'selection'], usesWeb: false, outputs: { dir: '복습', primary: '퀴즈' } }
const current = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'source', courseName: '생물학', material: { courseId: 'source', kind: 'note', relPath: 'cells.md', title: '세포' }, selection: 'Cells use energy.' }
const project = { binding, purpose: 'course-review', linkedCourseId: 'source', name: 'AI 학습자료', topic: '과목 자료', ai, revision: 1, articles: [], words: [], exports: [] }
afterEach(() => { if (root) act(() => root?.unmount()); root = null; vi.restoreAllMocks(); setIpcAdapter(null); document.body.replaceChildren(); useWorkspaceStore.setState({ surface: 'course' }); useCoursesStore.setState({ courses: [] }) })
function setup(withProject = true): ReturnType<typeof vi.fn> {
  useCoursesStore.setState({ courses: [{ id: 'source', name: '생물학', workspaceKind: 'course', createdAt: '2026-01-01', sortOrder: 0 }, { id: 'review', name: 'Review', workspaceKind: 'study-space', createdAt: '2026-02-01', sortOrder: 1 }] as any })
  const invoke = vi.fn(async (channel: string) => channel === 'learning:list' ? { projects: withProject ? [project] : [] } : channel === 'learning:get' ? project : channel === 'materials:tree' ? [{ kind: 'note', name: 'cells.md', relPath: 'cells.md' }]
    : channel === 'agent:availability' ? { installed: true, loggedIn: true } : channel === 'agent:models' ? { models: [{ id: 'pro', displayName: 'Pro', isDefault: false }], source: 'live', status: 'ready' } : { binding, runId: 'run' })
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter); return invoke
}
async function mount(node: React.ReactNode): Promise<void> { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root!.render(node) }) }
async function choose(label: string, value: string): Promise<void> { await act(async () => { const element = document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })) }) }
const submit = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('button[type="submit"]')!
const preview = (): string => document.querySelector('[aria-label="실행 내용 확인"]')!.textContent!

test('a tool opens without an implicit scope and shows its exact selection, output, default destination and verified saved AI before dispatch', async () => {
  const invoke = setup(); const onStart = vi.fn(async () => ({ status: 'started' as const, binding, runId: 'run', message: 'Started' }))
  const request: LearningGenerationRequest = { label: '퀴즈', entry, context: current, onStart }
  await mount(<LearningGenerationDialog request={request} onClose={vi.fn()} />)
  expect(submit().disabled).toBe(true); expect(invoke.mock.calls.some(call => call[0] === 'study:generate')).toBe(false)
  await choose('학습 원본 선택', 'current'); expect(submit().disabled).toBe(true)
  await choose('학습 원본 범위', 'selection')
  expect(preview()).toContain('세포 · cells.md · 선택한 부분'); expect(preview()).toContain('퀴즈'); expect(preview()).toContain('생물학 복습'); expect(preview()).toContain('gemini · pro')
  expect(document.querySelector('[aria-label="학습 저장 공간"]')).toBeNull()
  expect(submit().disabled).toBe(false)
  await act(async () => { submit().click() })
  expect(onStart).toHaveBeenCalledWith({ context: current, scope: 'selection', binding, ai })
})

test('an empty home requires an explicit course and file choice before new-space AI selection', async () => {
  setup(false); const onStart = vi.fn(async () => ({ status: 'started' as const, binding, runId: 'run', message: 'Started' }))
  await mount(<LearningGenerationDialog request={{ label: '퀴즈', entry, context: EMPTY_LAUNCHER_CONTEXT, onStart }} onClose={vi.fn()} />)
  expect(submit().disabled).toBe(true)
  await choose('학습 원본 선택', 'material'); expect(submit().disabled).toBe(true)
  await choose('학습 원본 과목', 'source'); expect(submit().disabled).toBe(true)
  await choose('학습 원본 자료', 'cells.md')
  expect(preview()).toContain('생물학 복습 · 새 공간')
  await choose('학습 AI 제공자', 'gemini'); await choose('학습 AI 모델', 'pro')
  await act(async () => { submit().click() })
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ scope: 'material', ai, context: expect.objectContaining({ courseId: 'source', sourcePanelId: null, material: expect.objectContaining({ relPath: 'cells.md' }) }) }))
  expect(onStart.mock.calls[0]![0]).not.toHaveProperty('binding')
})

test('current native vocabulary keeps exact word IDs and its saved binding through the generation form', async () => {
  const invoke = setup(); invoke.mockImplementation(async (channel: string) => channel === 'learning:get' ? { ...project, purpose: 'english-reading', words: [{ id: 'word-a' }, { id: 'word-b' }] } : channel === 'learning:list' ? { projects: [project] } : channel === 'agent:availability' ? { installed: true, loggedIn: true } : channel === 'agent:models' ? { models: [{ id: 'pro', displayName: 'Pro', isDefault: false }], status: 'ready' } : { binding, runId: 'cards' })
  const context = { ...EMPTY_LAUNCHER_CONTEXT, courseId: binding.courseId, binding, descriptor: { kind: 'learning' as const, payload: { ...binding, view: 'vocabulary' as const } }, wordIds: ['word-a', 'word-b'] }
  const onStart = vi.fn(async () => ({ status: 'started' as const, binding, runId: 'run', message: 'Started' }))
  await mount(<LearningGenerationDialog request={{ label: '카드', entry: { ...entry, experience: 'flashcards' }, context, onStart }} onClose={vi.fn()} />)
  await choose('학습 원본 선택', 'current'); await choose('학습 원본 범위', 'material')
  await act(async () => { submit().click() })
  expect(onStart).toHaveBeenCalledWith({ context, scope: 'material', binding, ai })
})

test('a study-space home offers no empty current source or course scope while its exact article remains available', async () => {
  setup()
  const context = { ...EMPTY_LAUNCHER_CONTEXT, courseId: binding.courseId, courseName: '영어 읽기', binding }
  const request: LearningGenerationRequest = { label: '퀴즈', entry, context, onStart: vi.fn() }
  await mount(<LearningGenerationDialog request={request} onClose={vi.fn()} />)
  expect(document.querySelector('[aria-label="학습 원본 선택"] option[value="current"]')).toBeNull()
  expect(submit().disabled).toBe(true)
  await act(async () => { root!.render(<LearningGenerationDialog request={{ ...request, context: { ...context, articleIds: ['article-a'] } }} onClose={vi.fn()} />) })
  await choose('학습 원본 선택', 'current')
  expect(document.querySelector('[aria-label="학습 원본 범위"] option[value="material"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="학습 원본 범위"] option[value="course"]')).toBeNull()
})

test('a browser owned by a study-space saves to its actual root with saved AI and blocks generation when that root is unavailable', async () => {
  const invoke = setup()
  const owned = { ...project, purpose: 'english-reading', linkedCourseId: null, name: '영어 읽기' }
  let available = true
  invoke.mockImplementation(async (channel: string) => channel === 'learning:list' ? { projects: available ? [owned] : [] } : channel === 'learning:get' ? owned : channel === 'agent:availability' ? { installed: true, loggedIn: true } : channel === 'agent:models' ? { models: [{ id: 'pro', displayName: 'Pro', isDefault: false }], status: 'ready' } : { binding, runId: 'run' })
  const browser = { tabId: 'browser-tab', url: 'https://example.org/read', title: 'Current English article' }
  const context = { ...EMPTY_LAUNCHER_CONTEXT, courseId: binding.courseId, courseName: '영어 읽기', browser, material: { courseId: binding.courseId, kind: 'browser', title: browser.title, url: browser.url, browserTabId: browser.tabId } }
  const onStart = vi.fn(async () => ({ status: 'started' as const, binding, runId: 'run', message: 'Started' }))
  const request: LearningGenerationRequest = { label: '퀴즈', entry, context, onStart }
  await mount(<LearningGenerationDialog request={request} onClose={vi.fn()} />)
  await choose('학습 원본 선택', 'current'); await choose('학습 원본 범위', 'material')
  expect(preview()).toContain('영어 읽기'); expect(preview()).not.toContain('복습 · 새 공간'); expect(preview()).toContain('gemini · pro')
  expect(document.querySelector('[aria-label="학습 저장 공간"]')).toBeNull()
  await act(async () => { submit().click() })
  expect(onStart).toHaveBeenCalledWith({ context, scope: 'material', binding, ai })
  available = false
  await act(async () => { root!.render(<LearningGenerationDialog key="missing-root" request={request} onClose={vi.fn()} />) })
  await choose('학습 원본 선택', 'current'); await choose('학습 원본 범위', 'material')
  expect(submit().disabled).toBe(true); expect(preview()).not.toContain('복습 · 새 공간')
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('학습 공간을 찾지 못했어요')
  expect(onStart).toHaveBeenCalledTimes(1)
})

test('a note closed while the generation form is open is rejected instead of using another source', async () => {
  const invoke = setup(); const context = { ...current, sourcePanelId: 'source-note' }
  const unregister = registerDocumentContext('source-note', () => ({ ...current.material, selection: current.selection }))
  vi.spyOn(navigation, 'openLearning').mockImplementation(() => {})
  await mount(<LearningDialogsHost />)
  await act(async () => { await requestFeatureAction(entry, context, { scope: 'selection', binding }) })
  unregister()
  await act(async () => { submit().click() })
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('닫혔거나 바뀌었어요')
  expect(invoke.mock.calls.some(call => call[0] === 'study:generate')).toBe(false)
})

test('learning home refuses a stale captured panel even for course scope and permits a freshly chosen course', async () => {
  const invoke = setup(); useWorkspaceStore.setState({ surface: 'learning-home' }); vi.spyOn(navigation, 'openLearning').mockImplementation(() => {})
  expect(await executeFeatureAction(entry, { ...current, sourcePanelId: 'hidden-note' }, 'course', { binding, ai })).toMatchObject({ status: 'failed', message: expect.stringContaining('이전 자료') })
  expect(invoke.mock.calls.some(call => call[0] === 'study:generate')).toBe(false)
  expect(await executeFeatureAction(entry, { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'source' }, 'course', { binding, ai })).toMatchObject({ status: 'started' })
  expect(invoke).toHaveBeenLastCalledWith('study:generate', { courseId: 'source', packId: 'quiz', binding, source: { kind: 'course', sourceCourseId: 'source' }, ai })
})
