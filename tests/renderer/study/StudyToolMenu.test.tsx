// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { StudyToolDefinition } from '../../../src/shared/types/study'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'
import { StudyToolMenu, isPackFollowUpAvailable } from '../../../src/renderer/src/features/study/StudyToolMenu'
import { isStudyToolEnabled } from '../../../src/renderer/src/features/study/studyToolAvailability'
import { studyToolFromPack, type PackStudyToolDefinition, useStudyToolsStore } from '../../../src/renderer/src/features/study/studyToolsStore'
import { EMPTY_LAUNCHER_CONTEXT } from '../../../src/renderer/src/features/launcher/launcherContext'
import { LearningDialogsHost } from '../../../src/renderer/src/features/learning/LearningDialogsHost'
import { MaterialsStudyToolMenuItem } from '../../../src/renderer/src/features/study/MaterialsStudyToolMenuItem'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useMaterialsStore } from '../../../src/renderer/src/stores/materialsStore'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { useWorkflowPacksStore } from '../../../src/renderer/src/stores/workflowPacksStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import * as navigation from '../../../src/renderer/src/features/learning/learningNavigation'
import * as toast from '../../../src/renderer/src/app/toast'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
const binding = { courseId: 'review', rootRelPath: '' }
const ai = { provider: 'gemini' as const, model: 'pro', effort: null }
const source = { ...EMPTY_LAUNCHER_CONTEXT, courseId: 'course-1', courseName: '항공역학', material: { courseId: 'course-1', relPath: '강의/lecture.pdf', kind: 'file', title: 'lecture.pdf' } }
const builtinTools = BUILTIN_PACKS.map(pack => studyToolFromPack({ pack, source: 'builtin', enabled: true }))
const project = { binding, purpose: 'course-review', linkedCourseId: 'course-1', name: '항공역학 복습', topic: '항공역학', ai, revision: 1, articles: [], words: [], exports: [] }
const installedPack: PackStudyToolDefinition = {
  id: 'custom:vocab-chain', label: '나의 단어 사슬', description: '기사에서 단어를 모아요.', worksOnCourse: false, source: 'user', usesWeb: true,
  outputs: { dir: '영어 학습', primary: '단어 사슬 리포트' }, followUp: { label: '이 기사로 이어가기', recipe: '다음 회차를 진행하라.' }
}
const fileOnlyTool: StudyToolDefinition = { id: 'explain', label: '쉽게 설명', description: '선택한 파일을 쉽게 풀어 설명해요.', worksOnCourse: false }

beforeEach(() => {
  adapter()
  useStudyToolsStore.setState({ tools: [], hasLoaded: true, isLoading: false, error: null, running: {}, runError: null })
  useUiStore.setState({ isSettingsOpen: false })
  useCoursesStore.setState({ courses: [{ id: 'course-1', name: '항공역학', workspaceKind: 'course', createdAt: '2026-01-01', sortOrder: 0 }, { id: 'review', name: '항공역학 복습', workspaceKind: 'study-space', createdAt: '2026-02-01', sortOrder: 1 }] as any })
  vi.spyOn(navigation, 'openLearning').mockImplementation(() => {})
  vi.spyOn(toast, 'showToast').mockImplementation(() => '')
})
afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null; setIpcAdapter(null); vi.restoreAllMocks(); document.body.replaceChildren()
  useCoursesStore.setState({ courses: [] }); useMaterialsStore.setState({ activeCourseId: null })
})
async function mount(element: React.ReactNode): Promise<void> {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(element))
}
async function click(label: string): Promise<void> {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
async function search(value: string): Promise<void> {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="학습 도구 검색"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function adapter(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string) => channel === 'learning:list' ? { projects: [project] } : channel === 'learning:get' ? project
    : channel === 'agent:availability' ? { installed: true, loggedIn: true } : channel === 'agent:models' ? { models: [{ id: 'pro', displayName: 'Pro' }], status: 'ready' }
    : channel === 'study:run' ? { relPath: 'AI 학습자료/result.md' } : { binding, runId: 'run-1' })
  setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
  return invoke
}

describe('study tool availability', () => {
  test('disables a file-only tool for a whole-course target', () => {
    expect(isStudyToolEnabled(fileOnlyTool, null)).toBe(false)
    expect(isStudyToolEnabled(fileOnlyTool, 'lecture-01.pdf')).toBe(true)
  })
  test('offers follow-up only below the exact output directory', () => {
    expect(isPackFollowUpAvailable(installedPack, '영어 학습/기사/새 기사.md')).toBe(true)
    expect(isPackFollowUpAvailable(installedPack, '영어 학습자료/다른 결과.md')).toBe(false)
    expect(isPackFollowUpAvailable({ ...installedPack, enabled: false }, '영어 학습/기사/새 기사.md')).toBe(false)
  })
})

describe('study palette', () => {
  test('shows the captured source, outcomes and grouped tools with a focused search', async () => {
    await mount(<StudyToolMenu request={{ context: source, returnFocus: null }} toolsOverride={[...builtinTools, installedPack]} onClose={vi.fn()} />)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[aria-label="선택한 학습 자료"]')?.textContent).toContain('강의/lecture.pdf')
    expect(document.activeElement).toBe(document.querySelector('[aria-label="학습 도구 검색"]'))
    expect(document.querySelector('.study-palette__featured')?.textContent).toContain('핵심 요약')
    expect(document.body.textContent).toContain('직접 푸는 퀴즈')
    expect(document.body.textContent).toContain('넘겨 보는 카드')
    expect(document.body.textContent).toContain('설치한 도구')
    expect(document.body.textContent).toContain('웹 검색')
    expect(document.body.textContent).not.toContain('영어 이어읽기')
    await search('나의 단어')
    expect(document.querySelectorAll('.study-palette__card')).toHaveLength(1)
    await search('검색결과없음')
    expect(document.querySelector('[role="status"]')?.textContent).toContain('일치하는 학습 도구가 없어요.')
  })

  test('reports empty, loading and recoverable error states instead of a blank picker', async () => {
    await mount(<StudyToolMenu request={{ context: source, returnFocus: null }} toolsOverride={[]} onClose={vi.fn()} />)
    expect(document.querySelector('[role="status"]')?.textContent).toContain('사용 가능한 학습 도구가 없어요.')
    const loadTools = vi.spyOn(useStudyToolsStore.getState(), 'loadTools').mockResolvedValue()
    const refresh = vi.spyOn(useWorkflowPacksStore.getState(), 'refresh').mockResolvedValue()
    await act(async () => {
      useStudyToolsStore.setState({ hasLoaded: false, isLoading: true })
      root!.render(<StudyToolMenu request={{ context: source, returnFocus: null }} onClose={vi.fn()} />)
    })
    expect(loadTools).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('불러오는 중')
    await act(async () => useStudyToolsStore.setState({ isLoading: false, error: '목록을 읽지 못했어요.' }))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('목록을 읽지 못했어요.')
    await click('다시 불러오기')
    expect(refresh).toHaveBeenCalledOnce()
  })

  test('exposes disabled reasons and user follow-up actions', async () => {
    const inside = { ...source, material: { ...source.material, relPath: '영어 학습/기사/새 기사.md' } }
    await mount(<StudyToolMenu request={{ context: inside, returnFocus: null }} toolsOverride={[installedPack, { ...fileOnlyTool, enabled: false }]} onClose={vi.fn()} />)
    expect(document.body.textContent).toContain('이 기사로 이어가기')
    const disabled = document.querySelector<HTMLButtonElement>('[aria-label="쉽게 설명"]')!
    expect(disabled.disabled).toBe(true)
    expect(document.getElementById(disabled.getAttribute('aria-describedby')!)?.textContent).toContain('비활성화')
  })

  test('moves to the shared setup in the same dialog and back without losing the search or target', async () => {
    const invoke = adapter()
    await mount(<StudyToolMenu request={{ context: source, returnFocus: null }} toolsOverride={builtinTools} onClose={vi.fn()} />)
    await search('퀴즈')
    await click('퀴즈 만들기')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[aria-label="학습 원본 선택"]')).toBeNull()
    expect(document.querySelector('[aria-label="실행 내용 확인"]')?.textContent).toContain('강의/lecture.pdf · 자료 전체')
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
    expect(invoke.mock.calls.some(([channel]) => channel === 'study:generate' || channel === 'study:run')).toBe(false)
    expect(toast.showToast).not.toHaveBeenCalled()
    await click('도구 선택으로 돌아가기')
    expect(document.querySelector<HTMLInputElement>('[aria-label="학습 도구 검색"]')?.value).toBe('퀴즈')
    expect(document.querySelector('[aria-label="선택한 학습 자료"]')?.textContent).toContain('강의/lecture.pdf')
    expect(document.activeElement).toBe(document.querySelector('[aria-label="학습 도구 검색"]'))
  })

  test('only explicit submit starts native generation and locks navigation while it is pending', async () => {
    const invoke = adapter(); const close = vi.fn(); let resolveRun!: (result: any) => void
    invoke.mockImplementation(async (channel: string) => channel === 'learning:list' ? { projects: [project] } : channel === 'learning:get' ? project
      : channel === 'agent:availability' ? { installed: true, loggedIn: true } : channel === 'agent:models' ? { models: [{ id: 'pro', displayName: 'Pro' }], status: 'ready' }
      : channel === 'study:generate' ? new Promise(resolve => { resolveRun = resolve }) : { binding, runId: 'run-1' })
    await mount(<StudyToolMenu request={{ context: source, returnFocus: null }} toolsOverride={builtinTools} onClose={close} />)
    await click('퀴즈 만들기')
    await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
    expect(invoke).toHaveBeenCalledWith('study:generate', { courseId: 'course-1', packId: 'quiz', binding, source: { kind: 'material', relPath: '강의/lecture.pdf', sourceCourseId: 'course-1' }, ai })
    expect(document.querySelector<HTMLButtonElement>('[aria-label="도구 선택으로 돌아가기"]')!.disabled).toBe(true)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).not.toHaveBeenCalled()
    await act(async () => resolveRun({ binding, runId: 'run-1' }))
    expect(close).toHaveBeenCalledOnce()
    expect(toast.showToast).toHaveBeenCalledOnce()
  })

  test('keeps legacy follow-up metadata through the shared setup without a premature running toast', async () => {
    const invoke = adapter()
    const inside = { ...source, material: { ...source.material, relPath: '영어 학습/기사/새 기사.md' } }
    await mount(<StudyToolMenu request={{ context: inside, returnFocus: null }} toolsOverride={[installedPack]} onClose={vi.fn()} />)
    await click('이 기사로 이어가기')
    expect(toast.showToast).not.toHaveBeenCalled()
    expect(invoke.mock.calls.some(([channel]) => channel === 'study:run')).toBe(false)
    await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
    expect(invoke).toHaveBeenCalledWith('study:run', { courseId: 'course-1', tool: installedPack.id, relPath: '영어 학습/기사/새 기사.md', followUpOf: installedPack.id })
  })

  test('the materials trigger captures the clicked file, closes its menu and restores its row on Escape', async () => {
    adapter(); useMaterialsStore.setState({ activeCourseId: 'course-1' })
    useWorkflowPacksStore.setState({ packs: BUILTIN_PACKS.map(pack => ({ pack, source: 'builtin', enabled: true })), hasLoaded: true, loading: false, error: null })
    const row = document.createElement('button'); row.textContent = 'source row'; document.body.append(row); row.focus()
    const closeMenu = vi.fn()
    await mount(<><MaterialsStudyToolMenuItem target={{ kind: 'pdf', relPath: 'clicked.pdf', name: 'clicked.pdf' }} returnFocus={row} onClose={closeMenu} /><LearningDialogsHost /></>)
    await click('이 자료로 학습하기…')
    expect(closeMenu).toHaveBeenCalledOnce()
    expect(document.querySelector('[aria-label="선택한 학습 자료"]')?.textContent).toContain('clicked.pdf')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(row)
  })
})
