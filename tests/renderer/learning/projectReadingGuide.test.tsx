// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import type { LearningProjectSnapshot } from '../../../src/shared/types/learning'

const state = vi.hoisted(() => ({
  project: { name: 'English', purpose: 'english-reading', articles: [], artifacts: [], words: [] } as unknown as LearningProjectSnapshot,
  workspace: { activeWorkspace: { kind: 'project', courseId: 'course', rootRelPath: 'English' }, surface: 'course', windowsOverviewOpen: false, activeTabDescriptor: () => null },
  ui: { isSettingsOpen: false },
  invoke: vi.fn()
}))
vi.mock('../../../src/renderer/src/features/learning/useLearningProject', () => ({ useLearningProject: () => ({ project: state.project, error: null }), refreshLearningProject: vi.fn() }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: Object.assign((select: (value: typeof state.workspace) => unknown) => select(state.workspace), { getState: () => state.workspace }) }))
vi.mock('../../../src/renderer/src/stores/uiStore', () => ({ useUiStore: Object.assign((select: (value: typeof state.ui) => unknown) => select(state.ui), { getState: () => state.ui }) }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: state.invoke }))
vi.mock('../../../src/renderer/src/features/learning/learningNavigation', () => ({ learningError: String, openLearningResource: vi.fn() }))
vi.mock('../../../src/renderer/src/features/learning/LearningMaterialImportDialog', () => ({ LearningMaterialImportDialog: () => null }))
vi.mock('../../../src/renderer/src/features/learning/LearningCreateDialog', () => ({ LearningCreateDialog: () => null }))
vi.mock('../../../src/renderer/src/features/learning/learningStartedRuns', () => ({ startLearningRun: vi.fn() }))
vi.mock('../../../src/renderer/src/features/browser/webviewPassthrough', () => ({ acquirePointerPassthrough: () => () => {} }))
import { ProjectMaterials } from '../../../src/renderer/src/features/learning/ProjectMaterials'

test('existing English projects introduce reading once on their workspace and allow replay without AI', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (): void => act(() => root.render(<ProjectMaterials binding={{ courseId: 'course', rootRelPath: 'English' }} query="" />))
  const guide = (): Element | null => document.querySelector('[role="dialog"][aria-label="영어 읽기 사용 방법"]')
  try {
    state.project.purpose = 'course-review'
    render()
    expect(guide()).toBeNull()
    expect(container.querySelector('[aria-label="영어 읽기 사용 방법"]')).toBeNull()
    state.project.purpose = 'english-reading'
    state.workspace.windowsOverviewOpen = true
    render()
    expect(guide()).toBeNull()
    state.workspace.windowsOverviewOpen = false
    state.ui.isSettingsOpen = true
    render()
    expect(guide()).toBeNull()
    state.ui.isSettingsOpen = false
    render()
    expect(guide()).not.toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="소개 닫기"]')!.click())
    expect(guide()).toBeNull()
    expect(localStorage.getItem('bandal:english-reading-guide:v1')).toBe('seen')
    render()
    expect(guide()).toBeNull()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="영어 읽기 사용 방법"]')!.click())
    expect(guide()).not.toBeNull()
    expect(state.invoke).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    container.remove()
    localStorage.clear()
  }
})
