// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { LearningProjectSnapshot } from '../../../src/shared/types/learning'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), flush: vi.fn(), relocate: vi.fn(), toast: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ flushLearningResourcesForPath: mocks.flush, reconcileWorkspaceMaterialRename: mocks.relocate }))
vi.mock('../../../src/renderer/src/features/learning/learningNavigation', () => ({ learningError: (error: Error) => error.message }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
import { updateLearningProjectSnapshot, useLearningProject } from '../../../src/renderer/src/features/learning/useLearningProject'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.resetAllMocks(); document.body.replaceChildren() })

test.each([false, true])('external relocation requires successful pending writes (%s)', async allowed => {
  const binding = { courseId: `external-${allowed}`, rootRelPath: 'Before' }
  const project = { projectId: 'portable-id', binding, revision: 1, name: 'Retained quiz' } as LearningProjectSnapshot
  updateLearningProjectSnapshot(project)
  mocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'learning:get') throw new Error('folder missing')
    return { projects: [{ projectId: project.projectId, binding: { ...binding, rootRelPath: 'After' }, warning: null }] }
  })
  mocks.flush.mockResolvedValue(allowed)
  function Host() {
    const snapshot = useLearningProject(binding)
    return <div>{snapshot.error ?? snapshot.project?.name}</div>
  }
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element)
  await act(async () => { root.render(<Host />) })
  expect(mocks.flush).toHaveBeenCalledWith(binding.courseId, 'Before')
  if (allowed) {
    expect(mocks.relocate).toHaveBeenCalledWith(binding.courseId, 'Before', 'After')
    expect(mocks.toast).not.toHaveBeenCalled()
  } else {
    expect(mocks.relocate).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('기존 창을 유지'), 'danger')
    expect(element.textContent).toBe('Retained quiz')
  }
  act(() => root.unmount())
})
