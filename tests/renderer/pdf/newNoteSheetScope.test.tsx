// @vitest-environment jsdom
import { act } from 'react'
import { expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), load: vi.fn(), toast: vi.fn(), course: 'first' }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: { getState: () => ({ selectedCourseId: mocks.course }) } }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ surface: 'course', activeWorkspace: { kind: 'course', courseId: mocks.course }, openTab: mocks.open }) } }))
vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({ useMaterialsStore: { getState: () => ({ loadTree: mocks.load }) } }))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({ settingsSnapshot: () => ({ tabs: { notePaper: 'lines', noteOrientation: 'portrait' } }) }))
import { openNewNoteSheet } from '../../../src/renderer/src/features/pdfNotes/NewNoteSheet'

test('a delayed paper creation stays in its original course and cannot replace a busy sheet', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockReturnValue(new Promise(done => { resolve = done }))
  await act(() => openNewNoteSheet('first'))
  const dialog = document.querySelector('[aria-label="새 노트"]')!
  await act(() => [...dialog.querySelectorAll('button')].find(button => button.textContent === '만들기')!.click())
  mocks.course = 'second'
  await act(() => openNewNoteSheet('second'))
  expect(document.querySelector('[aria-label="새 노트"]')).toBe(dialog)
  await act(async () => resolve({ relPath: '노트/원래 과목.pdf' }))
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.load).toHaveBeenCalledWith('first', { refreshOnly: true })
  expect(mocks.toast).toHaveBeenCalledWith('원래 공간에 새 노트를 만들었어요.')
  expect(document.querySelector('[aria-label="새 노트"]')).toBeNull()
})
