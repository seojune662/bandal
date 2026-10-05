// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { LearningProjectSnapshot, LearningRun } from '../../../src/shared/types/learning'
import { LearningProjectHome } from '../../../src/renderer/src/features/learning/LearningProjectHome'
import { LearningRunStatus } from '../../../src/renderer/src/features/learning/LearningRunStatus'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { useLearningProjects } from '../../../src/renderer/src/features/learning/LearningProjects'
import * as materialNavigation from '../../../src/renderer/src/features/workspace/openMaterial'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); setIpcAdapter(null); vi.restoreAllMocks() })
const ai = { provider: 'gemini' as const, model: 'pro', effort: null }
const binding = { courseId: 'study', rootRelPath: '' }
function project(): LearningProjectSnapshot { return { schemaVersion: 1, revision: 1, projectId: 'project', name: 'Review', topic: 'Biology', purpose: 'course-review', linkedCourseId: 'source-course', ai, articles: [], words: [], occurrences: [], cards: [], quizAttempts: [], artifacts: [], runs: [], exports: [], history: [], recovery: 'none', warnings: [], binding } as unknown as LearningProjectSnapshot }
function render(element: React.ReactNode): HTMLDivElement { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(element)); return host }
const actions = () => ({ onNavigate: vi.fn(), onRun: vi.fn(), onSettings: vi.fn() })
function failed(category: LearningRun['errorCategory']): LearningRun { return { id: 'failure', kind: 'find-articles', status: 'failed', provider: 'gemini', model: 'pro', effort: null, errorCategory: category, errorCode: 'model-unavailable', sessionId: 'session', error: 'Failure', articleIds: [], wordIds: [], message: '', draft: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' } }

test('review home offers actual reviews and cross-course evidence without any English first-article action', async () => {
  const state = project(); state.artifacts = [{ id: 'quiz', kind: 'quiz', title: 'Cells quiz', sourceRefs: [{ kind: 'material', sourceCourseId: 'source-course', relPath: 'cells.md', quote: 'Cells use energy.' }] } as any]
  const props = actions()
  const invoke = vi.fn(async () => ({ sourceCourseId: 'source-course', relPath: 'cells.md', missing: false }))
  const open = vi.spyOn(materialNavigation, 'openMaterialInCourse').mockImplementation(() => {})
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  const host = render(<LearningProjectHome project={state} pending={false} running={false} {...props} />)
  expect(host.textContent).toContain('내 자료를 다시 익혀요.'); expect(host.textContent).not.toContain('첫 영어 글 찾기')
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('cells.md'))!.click() })
  expect(open).toHaveBeenCalledWith('source-course', 'note', 'cells.md')
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('최근 복습 자료 열기'))!.click())
  expect(props.onNavigate).toHaveBeenCalledWith('review', 'quiz')
  expect(props.onRun).not.toHaveBeenCalled()
})

test('unknown home requires an explicit purpose confirmation and preserves access to existing records', () => {
  const state = project(); state.purpose = 'unclassified'; delete state.ai
  const props = actions(); const host = render(<LearningProjectHome project={state} pending={false} running={false} {...props} />)
  expect(host.textContent).toContain('기존 기사, 단어, 퀴즈와 카드는 보존')
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('학습 종류와 AI 확인하기'))!.click())
  expect(props.onSettings).toHaveBeenCalledOnce(); expect(props.onRun).not.toHaveBeenCalled()
})

test('model rejection disables identical retry, shows actionable details, and allows a changed model', () => {
  const onRetry = vi.fn(), onSettings = vi.fn()
  const props = { run: failed('model'), ai, pending: false, onCancel: vi.fn(), onRetry, onSettings, onConnection: vi.fn() }
  const host = render(<LearningRunStatus {...props} />)
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '다시 시도')!.disabled).toBe(true)
  expect(host.querySelector('details')!.textContent).toContain('model-unavailable')
  expect(host.querySelector('details')!.textContent).toContain('session')
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'AI 모델 다시 선택')!.click())
  expect(onSettings).toHaveBeenCalledOnce()
  act(() => root!.render(<LearningRunStatus {...props} ai={{ ...ai, model: 'flash' }} />))
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '다시 시도')!.disabled).toBe(false)
})

test('quota can be retried with the same model, while connection failure waits for an actual availability check', async () => {
  const props = { run: failed('quota'), ai, pending: false, onCancel: vi.fn(), onRetry: vi.fn(), onSettings: vi.fn(), onConnection: vi.fn() }
  const host = render(<LearningRunStatus {...props} />)
  const retry = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '다시 시도')!
  expect(retry().disabled).toBe(false)
  act(() => root!.render(<LearningRunStatus {...props} run={failed('connection')} />))
  expect(retry().disabled).toBe(true)
  const invoke = vi.fn(async () => ({ installed: true, loggedIn: true }))
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '연결 다시 확인')!.click() })
  expect(invoke).toHaveBeenCalledWith('agent:availability', { provider: 'gemini' }); expect(retry().disabled).toBe(false)
})

test('a linked review project push reloads source-course project lists even when the destination owns another course', async () => {
  const invoke = vi.fn(async () => ({ projects: [] }))
  let push!: (input: any) => void
  setIpcAdapter({ invoke, on: (channel: string, callback: any) => { if (channel === 'learning:changed') push = callback; return () => {} } } as unknown as IpcAdapter)
  function Host(): JSX.Element { const state = useLearningProjects('source-course'); return <p>{state.projects.length}</p> }
  await act(async () => { render(<Host />) })
  expect(invoke).toHaveBeenCalledTimes(1)
  await act(async () => { push({ binding }) })
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke).toHaveBeenLastCalledWith('learning:list', { courseId: 'source-course' })
})
