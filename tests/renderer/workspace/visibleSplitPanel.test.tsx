// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import type { DockviewPanelApi } from 'dockview'
import { useHasBeenShown } from '../../../src/renderer/src/features/workspace/useHasBeenShown'
import { usePanelActive } from '../../../src/renderer/src/features/workspace/usePanelActive'
import { usePanelVisible } from '../../../src/renderer/src/features/workspace/usePanelVisible'
import { CourseActivity } from '../../../src/renderer/src/features/workspace/courseActivity'

test('a visible unfocused split loads; a hidden tab stays lazy and remains loaded after visiting', () => {
  let activeCallback = () => {}, visibleCallback = () => {}
  const api = { isActive: false, isVisible: false,
    onDidActiveChange: (fn: () => void) => { activeCallback = fn; return { dispose() {} } },
    onDidVisibilityChange: (fn: () => void) => { visibleCallback = fn; return { dispose() {} } }
  }
  function Panel() { return <span>{useHasBeenShown(api as unknown as DockviewPanelApi) ? 'loaded' : 'waiting'}</span> }
  const container = document.createElement('div'), root = createRoot(container)
  act(() => root.render(<Panel />))
  expect(container.textContent).toBe('waiting')
  act(() => { api.isVisible = true; visibleCallback() })
  expect(container.textContent).toBe('loaded')
  act(() => { api.isVisible = false; visibleCallback(); activeCallback() })
  expect(container.textContent).toBe('loaded')
  act(() => root.unmount())
})

test('a retained hidden canvas cannot own paste or keyboard activity in another course', () => {
  const api = { isActive: true, isVisible: true,
    onDidActiveChange: () => ({ dispose() {} }), onDidVisibilityChange: () => ({ dispose() {} }) } as unknown as DockviewPanelApi
  function Panel() { return <span>{usePanelActive(api) ? 'input owner' : 'inactive'}</span> }
  const container = document.createElement('div'), root = createRoot(container)
  act(() => root.render(<CourseActivity.Provider value={true}><Panel /></CourseActivity.Provider>))
  expect(container.textContent).toBe('input owner')
  act(() => root.render(<CourseActivity.Provider value={false}><Panel /></CourseActivity.Provider>))
  expect(container.textContent).toBe('inactive')
  act(() => root.unmount())
})

test('scrolling belongs to a visible split even without focus, but stops in hidden tabs and courses', () => {
  let visibleChanged = () => {}
  const api = { isActive: false, isVisible: true,
    onDidVisibilityChange: (callback: () => void) => {
      visibleChanged = callback
      return { dispose() {} }
    }
  } as unknown as DockviewPanelApi
  function Panel() { return <span>{usePanelVisible(api) ? 'scrollable' : 'hidden'}</span> }
  const container = document.createElement('div'), root = createRoot(container)
  act(() => root.render(<CourseActivity.Provider value={true}><Panel /></CourseActivity.Provider>))
  expect(container.textContent).toBe('scrollable')
  act(() => { Object.assign(api, { isVisible: false }); visibleChanged() })
  expect(container.textContent).toBe('hidden')
  act(() => { Object.assign(api, { isVisible: true }); visibleChanged() })
  expect(container.textContent).toBe('scrollable')
  act(() => root.render(<CourseActivity.Provider value={false}><Panel /></CourseActivity.Provider>))
  expect(container.textContent).toBe('hidden')
  act(() => root.unmount())
})
