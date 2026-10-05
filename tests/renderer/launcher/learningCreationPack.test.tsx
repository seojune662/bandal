// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { LearningDialogsHost, requestLearningCreation, requestLearningArticleImport } from '../../../src/renderer/src/features/learning/LearningDialogsHost'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import * as navigation from '../../../src/renderer/src/features/learning/learningNavigation'
import type { LearningProjectSnapshot } from '../../../src/shared/types/learning'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
const binding = { courseId: 'new-course', rootRelPath: '' }
const ai = { provider: 'codex', model: 'real-model', effort: null }
const catalog = { models: [{ id: 'default', displayName: 'Default', isDefault: true }, { id: 'real-model', displayName: 'Model', isDefault: false, supportedEfforts: ['low', 'high'] }], source: 'live', status: 'ready' }
afterEach(() => { if (root) act(() => root?.unmount()); root = null; vi.restoreAllMocks(); setIpcAdapter(null); useUiStore.setState({ isSettingsOpen: false }); document.body.replaceChildren(); localStorage.clear() })
async function mount(): Promise<void> { const element = document.createElement('div'); document.body.append(element); root = createRoot(element); await act(async () => { root!.render(<LearningDialogsHost />) }) }
function field(label: string): HTMLInputElement | HTMLSelectElement { return document.querySelector(`[aria-label="${label}"]`)! }
async function fill(label: string, value: string): Promise<void> { const element = field(label); await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
async function chooseAI(): Promise<void> { await fill('학습 AI 제공자', 'codex'); await fill('학습 AI 모델', 'real-model') }
async function chooseReading(): Promise<void> { await fill('학습 공간 이름', '우주 읽기'); await act(async () => { field('주제 우주').click() }); await fill('편한 영어 수준', 'intermediate'); await fill('한 편의 읽기 시간', '4') }
function saveButton(): HTMLButtonElement { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '학습 공간 만들기' || item.textContent === '설정 저장')! }
function adapter(options: { connected?: boolean; blocked?: string[] } = {}): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string, input: any) => channel === 'agent:availability' ? { installed: true, loggedIn: options.connected !== false }
    : channel === 'agent:models' ? { ...catalog, blockedModelIds: options.blocked ?? [] }
    : channel === 'learning:create' || channel === 'learning:updateSettings' ? { ...input, binding, articles: [] }
    : channel === 'learning:list' ? { projects: [] } : { runId: 'run', binding })
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  vi.spyOn(useCoursesStore.getState(), 'loadCourses').mockResolvedValue()
  vi.spyOn(navigation, 'openLearning').mockImplementation(() => {})
  return invoke
}

test('English creation starts empty, limits 14 topics to three, and requires a connected explicit model before standalone creation', async () => {
  const invoke = adapter(); await mount(); await act(async () => { requestLearningCreation('irrelevant-course', 'custom:space-reading') })
  expect(field('학습 공간 이름').value).toBe(''); expect(field('편한 영어 수준').value).toBe(''); expect(field('한 편의 읽기 시간').value).toBe(''); expect(field('학습 AI 제공자').value).toBe(''); expect(field('학습 AI 모델').value).toBe('')
  expect(document.querySelectorAll('.learning-topic-picker input')).toHaveLength(14)
  expect(saveButton().disabled).toBe(true)
  await chooseReading()
  await act(async () => { field('주제 과학').click(); field('주제 환경').click() })
  expect(field('주제 스포츠').disabled).toBe(true)
  expect(saveButton().disabled).toBe(true)
  await chooseAI()
  expect(document.querySelector('[aria-label="학습 AI 모델"] option[value="default"]')).toBeNull()
  expect(saveButton().disabled).toBe(false)
  await act(async () => { saveButton().click() })
  expect(invoke).toHaveBeenCalledWith('learning:create', expect.objectContaining({ placement: 'standalone', topicIds: ['space', 'science', 'environment'], purpose: 'english-reading', readingSetupConfirmed: true, ai }))
  expect(invoke.mock.calls.find(call => call[0] === 'learning:create')![1]).not.toHaveProperty('courseId')
  expect(invoke).toHaveBeenCalledWith('learning:run', { binding, kind: 'find-articles', packId: 'custom:space-reading' })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('disconnected AI and a rejected model keep creation disabled without sending a create request', async () => {
  const invoke = adapter({ connected: false }); await mount(); await act(async () => { requestLearningCreation() }); await chooseReading(); await fill('학습 AI 제공자', 'codex')
  expect(field('학습 AI 모델').disabled).toBe(true); expect(saveButton().disabled).toBe(true)
  expect(invoke.mock.calls.some(call => call[0] === 'learning:create')).toBe(false)
  invoke.mockImplementation(async (channel: string) => channel === 'agent:availability' ? { installed: true, loggedIn: true } : { ...catalog, blockedModelIds: ['real-model'] })
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '연결 · 모델 새로고침')!.click() })
  expect(field('학습 AI 모델').disabled).toBe(true)
  expect(saveButton().disabled).toBe(true)
})

test('opening AI settings suspends the modal trap and keeps form draft, then refreshes connection on return', async () => {
  const invoke = adapter({ connected: false }); await mount(); await act(async () => { requestLearningCreation() }); await chooseReading(); await fill('학습 AI 제공자', 'codex')
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'AI 연결 설정 열기')!.click() })
  expect(useUiStore.getState().isSettingsOpen).toBe(true)
  expect(document.querySelector<HTMLElement>('.dialog-backdrop')!.style.display).toBe('none')
  invoke.mockImplementation(async (channel: string) => channel === 'agent:availability' ? { installed: true, loggedIn: true } : catalog)
  await act(async () => { useUiStore.setState({ isSettingsOpen: false }) })
  expect(field('학습 공간 이름').value).toBe('우주 읽기')
  expect(field('학습 AI 제공자').value).toBe('codex')
  expect(invoke).toHaveBeenCalledWith('agent:models', { provider: 'codex', refresh: true })
  await fill('학습 AI 모델', 'real-model'); expect(saveButton().disabled).toBe(false)
})

test('classifying an old root does not change workspace kind unless the user separately checks that option', async () => {
  const invoke = adapter()
  useCoursesStore.setState({ courses: [{ id: binding.courseId, name: 'Real course', workspaceKind: 'course' } as any] })
  await mount()
  const project = { binding, revision: 7, name: 'Old notes', topic: 'Old topic', purpose: 'unclassified', articles: [] } as unknown as LearningProjectSnapshot
  await act(async () => { requestLearningCreation(undefined, undefined, project) })
  await fill('학습 공간 종류', 'course-review'); await chooseAI()
  await act(async () => { saveButton().click() })
  const saved = invoke.mock.calls.find(call => call[0] === 'learning:updateSettings')![1]
  expect(saved).toMatchObject({ binding, expectedRevision: 7, purpose: 'course-review', readingSetupConfirmed: false, ai })
  expect(saved).not.toHaveProperty('workspaceKind')
  expect(invoke.mock.calls.some(call => call[0] === 'learning:run')).toBe(false)
})

test('changing a space purpose uses its matching recipe and preserves custom recipes only within the same purpose', async () => {
  const invoke = adapter(); await mount()
  const review = { binding, revision: 1, name: 'Review', topic: 'Course material', purpose: 'course-review', packId: 'flashcards', ai, articles: [] } as unknown as LearningProjectSnapshot
  await act(async () => { requestLearningCreation(undefined, undefined, review) })
  await fill('학습 공간 종류', 'english-reading'); await chooseReading()
  await act(async () => { saveButton().click() })
  expect(invoke).toHaveBeenCalledWith('learning:updateSettings', expect.objectContaining({ purpose: 'english-reading', packId: 'vocab-chain-en' }))
  expect(invoke).toHaveBeenCalledWith('learning:run', { binding, kind: 'find-articles', packId: 'vocab-chain-en' })

  const english = { ...review, purpose: 'english-reading', packId: 'custom:space-reading', topicIds: ['space'], readingSetupConfirmed: true, level: 'intermediate', readingMinutes: 4 } as LearningProjectSnapshot
  invoke.mockClear()
  await act(async () => { requestLearningCreation(undefined, undefined, english) })
  await act(async () => { saveButton().click() })
  expect(invoke).toHaveBeenCalledWith('learning:updateSettings', expect.objectContaining({ purpose: 'english-reading', packId: 'custom:space-reading' }))
  expect(invoke).toHaveBeenCalledWith('learning:run', { binding, kind: 'find-articles', packId: 'custom:space-reading' })

  invoke.mockClear()
  await act(async () => { requestLearningCreation(undefined, undefined, english) })
  await fill('학습 공간 종류', 'course-review')
  await act(async () => { saveButton().click() })
  expect(invoke).toHaveBeenCalledWith('learning:updateSettings', expect.objectContaining({ purpose: 'course-review', packId: 'quiz' }))
  expect(invoke.mock.calls.some(call => call[0] === 'learning:run')).toBe(false)

  invoke.mockClear()
  await act(async () => { requestLearningCreation(undefined, undefined, review) })
  await act(async () => { saveButton().click() })
  expect(invoke).toHaveBeenCalledWith('learning:updateSettings', expect.objectContaining({ purpose: 'course-review', packId: 'flashcards' }))
})

test('the real article import dialog opens the host-retained duplicate with its separate source course', async () => {
  const target = { courseId: 'course', rootRelPath: 'Reading' }
  const invoke = vi.fn(async (channel: string) => channel === 'learning:list' ? { projects: [{ binding: target, name: 'Reading', purpose: 'english-reading' }] }
    : { binding: target, addedArticleId: 'original', articles: [{ id: 'original' }, { id: 'last-unrelated' }] })
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  const open = vi.spyOn(navigation, 'openLearning').mockImplementation(() => {})
  await mount(); await act(async () => { requestLearningArticleImport({ courseId: 'source-course', url: 'https://mirror.example.com/story', tabId: 'browser-source' }) })
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '학습에 추가')!.click() })
  expect(invoke).toHaveBeenCalledWith('learning:addArticle', { binding: target, url: 'https://mirror.example.com/story', tabId: 'browser-source', sourceCourseId: 'source-course' })
  expect(open).toHaveBeenCalledWith(target, 'reader', 'original')
})


test('an unsupported saved effort remains visible and blocks saving until explicitly cleared, even if the model has no effort options', async () => {
  const invoke = adapter()
  invoke.mockImplementation(async (channel: string, input: any) => channel === 'agent:availability' ? { installed: true, loggedIn: true }
    : channel === 'agent:models' ? { ...catalog, models: [{ id: 'real-model', displayName: 'Model', isDefault: false, supportedEfforts: [] }] }
    : { ...input, binding, articles: [] })
  await mount()
  const project = { binding, revision: 1, name: 'Saved review', topic: 'Course material', purpose: 'course-review', ai: { ...ai, effort: 'legacy-ultra' }, articles: [] } as unknown as LearningProjectSnapshot
  await act(async () => { requestLearningCreation(undefined, undefined, project) })
  expect(field('학습 AI Effort').value).toBe('legacy-ultra')
  expect(document.querySelector<HTMLOptionElement>('option[value="legacy-ultra"]')!.disabled).toBe(true)
  expect(saveButton().disabled).toBe(true)
  expect(field('학습 AI 모델').value).toBe('real-model')
  await fill('학습 AI Effort', '')
  expect(saveButton().disabled).toBe(false)
  await act(async () => { saveButton().click() })
  expect(invoke).toHaveBeenCalledWith('learning:updateSettings', expect.objectContaining({ ai: { ...ai, effort: null } }))
})
