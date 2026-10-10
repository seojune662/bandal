// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CourseTabMoveOverlay } from '../../../src/renderer/src/features/workspace/CourseTabMoveOverlay'
import { BANDAL_TAB_DRAG_MIME } from '../../../src/renderer/src/features/workspace/tabDrag'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'

const workspace = vi.hoisted(() => ({
  state: { activeCourseId: 'source', surface: 'course', hydration: 'ready' }, api: { groups: [] as unknown[] },
  listeners: new Set<(state: { activeCourseId: string; surface: string; hydration: string }) => void>()
}))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => workspace.state, subscribe: (listener: (state: typeof workspace.state) => void) => {
    workspace.listeners.add(listener); return () => workspace.listeners.delete(listener)
  } },
  workspaceApiForCourse: () => workspace.api
}))
vi.mock('../../../src/renderer/src/features/workspace/workspaceTabDrop', () => ({ dropWorkspaceTabOnCourse: vi.fn() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let reactRoot: Root, host: HTMLElement, canvas: HTMLElement, sidebar: HTMLElement
function box(element: HTMLElement, x: number, y: number, width: number, height: number) {
  element.getBoundingClientRect = () => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) })
}
function drag(element: HTMLElement, type: string, x: number, y: number, relatedTarget?: Node) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: x, clientY: y, relatedTarget, dataTransfer: { types: [BANDAL_TAB_DRAG_MIME], dropEffect: 'none' } })
  act(() => { element.dispatchEvent(event) })
  return event
}
beforeEach(() => {
  host = document.createElement('main'); host.className = 'workspace-host'; box(host, 200, 40, 800, 600)
  canvas = document.createElement('div'); host.append(canvas)
  sidebar = document.createElement('aside'); box(sidebar, 0, 40, 200, 600)
  const overlay = document.createElement('div'); host.append(overlay); document.body.append(sidebar, host)
  workspace.api.groups = []
  Object.assign(workspace.state, { activeCourseId: 'source', surface: 'course', hydration: 'ready' })
  reactRoot = createRoot(overlay)
  act(() => { reactRoot.render(<CourseTabMoveOverlay />) })
  act(() => tabDragSession.beginTab({ courseId: 'source', panelId: 'panel', nonce: 'held' }))
})
afterEach(() => {
  act(() => reactRoot.unmount())
  tabDragSession.end(); vi.restoreAllMocks(); vi.useRealTimers(); Reflect.deleteProperty(document, 'elementFromPoint'); document.body.replaceChildren()
})

test('entering the folder area removes the split guide before its first dragover', () => {
  drag(canvas, 'dragover', 700, 300)
  expect(host.querySelector('.course-tab-move-preview')).not.toBeNull()
  expect(host.dataset.tabDragOutside).toBeUndefined()
  drag(sidebar, 'dragenter', 160, 300)
  expect(host.dataset.tabDragOutside).toBe('true')
  expect(host.querySelector('.course-tab-move-preview')).toBeNull()
  expect(tabDragSession.getSource()?.nonce).toBe('held')
  drag(canvas, 'dragenter', 700, 300)
  expect(host.dataset.tabDragOutside).toBeUndefined()
  expect(host.querySelector('.course-tab-move-preview')).not.toBeNull()
})

test('dragleave between canvas children does not erase the current destination', () => {
  drag(canvas, 'dragover', 700, 300)
  const next = document.createElement('div'); canvas.append(next)
  drag(canvas, 'dragleave', 700, 300, next)
  expect(host.dataset.tabDragOutside).toBeUndefined()
  expect(host.querySelector('.course-tab-move-preview')).not.toBeNull()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => next) })
  drag(canvas, 'dragleave', 700, 300)
  expect(host.dataset.tabDragOutside).toBeUndefined()
  expect(host.querySelector('.course-tab-move-preview')).not.toBeNull()
})

test('a stale workspace target with sidebar coordinates never creates a split preview', () => {
  drag(canvas, 'dragover', 700, 300)
  drag(canvas, 'dragenter', 160, 300)
  expect(host.dataset.tabDragOutside).toBe('true')
  expect(host.querySelector('.course-tab-move-preview')).toBeNull()
})


test('a course that becomes ready under a stationary held pointer restores its preview without another drag event', () => {
  vi.useFakeTimers()
  workspace.state.hydration = 'loading'
  drag(canvas, 'dragenter', 700, 300)
  expect(host.querySelector('.course-tab-move-preview')).toBeNull()
  act(() => {
    workspace.state.hydration = 'ready'
    for (const listener of workspace.listeners) listener(workspace.state)
    vi.advanceTimersToNextFrame()
  })
  expect(host.querySelector('.course-tab-move-preview')).not.toBeNull()
})

test('hydration finishing after the pointer enters the sidebar cannot revive a split preview', () => {
  vi.useFakeTimers()
  workspace.state.hydration = 'loading'
  drag(canvas, 'dragenter', 700, 300)
  drag(sidebar, 'dragenter', 160, 300)
  act(() => {
    workspace.state.hydration = 'ready'
    for (const listener of workspace.listeners) listener(workspace.state)
    vi.advanceTimersToNextFrame()
  })
  expect(host.querySelector('.course-tab-move-preview')).toBeNull()
  expect(host.dataset.tabDragOutside).toBe('true')
})
