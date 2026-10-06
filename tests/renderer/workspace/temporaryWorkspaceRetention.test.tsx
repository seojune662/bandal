// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceStore, resetWorkspaceStoreForTests } from '../../../src/renderer/src/stores/workspaceStore'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useTemporaryWorkspaceRetention } from '../../../src/renderer/src/features/workspace/useTemporaryWorkspaceRetention'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(async () => ({ ok: true })), onPush: vi.fn(() => () => {}) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
const scratch = { kind: 'browser' as const, payload: { tabId: 'scratch', initialUrl: 'https://gemini.google.com/app' } }

/** Mirrors the host's render-before-setActiveCourse ordering. */
function Host() {
  const selected = useCoursesStore(state => state.selectedCourseId)
  const retained = useTemporaryWorkspaceRetention()
  useLayoutEffect(() => { useWorkspaceStore.setState({ activeCourseId: selected, openTabs: {} }) }, [selected])
  return <div>{(retained || selected === null) && <textarea data-temporary defaultValue="temporary draft" />}</div>
}

beforeEach(() => {
  resetWorkspaceStoreForTests()
  useCoursesStore.setState({ selectedCourseId: null })
  container = document.createElement('div'); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); resetWorkspaceStoreForTests(); vi.clearAllMocks() })

test('an unused initial temporary workspace does not consume a retained course slot', () => {
  act(() => root.render(<Host />))
  expect(container.querySelector('[data-temporary]')).not.toBeNull()
  act(() => useCoursesStore.setState({ selectedCourseId: 'first-course' }))
  expect(container.querySelector('[data-temporary]')).toBeNull()
})

test('a used temporary workspace keeps its exact content through the first course-selection commit', () => {
  act(() => root.render(<Host />))
  const content = container.querySelector<HTMLTextAreaElement>('[data-temporary]')!
  content.value = 'unsaved Gemini draft'
  act(() => {
    useWorkspaceStore.setState({ openTabs: { scratch } })
    useCoursesStore.setState({ selectedCourseId: 'first-course' })
  })
  expect(container.querySelector('[data-temporary]')).toBe(content)
  expect(content.value).toBe('unsaved Gemini draft')
  expect(useWorkspaceStore.getState().openTabs).toEqual({})
})

test('a temporary workspace used after returning from a course also latches before the next selection', () => {
  useCoursesStore.setState({ selectedCourseId: 'deleted-course' })
  act(() => root.render(<Host />))
  expect(container.querySelector('[data-temporary]')).toBeNull()
  act(() => useCoursesStore.setState({ selectedCourseId: null }))
  const content = container.querySelector('[data-temporary]')
  act(() => useWorkspaceStore.setState({ openTabs: { scratch } }))
  act(() => useCoursesStore.setState({ selectedCourseId: 'next-course' }))
  expect(container.querySelector('[data-temporary]')).toBe(content)
})
