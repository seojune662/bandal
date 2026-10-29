// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ mounts: 0, workspace: { kind: 'course' as const, courseId: 'course-1' } }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: vi.fn(() => () => {}) }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: (select: (state: unknown) => unknown) => select({ activeWorkspace: fixture.workspace }) }))
vi.mock('../../../src/renderer/src/components/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../../src/renderer/src/features/assistantPanel/WorkspaceAssistantPanel', () => ({ WorkspaceAssistantPanel: () => <div>AI</div> }))
vi.mock('../../../src/renderer/src/features/materials/MaterialsSidebar', () => ({ MaterialsSidebar: ({ expanded, onToggleExpanded }: { expanded: boolean; onToggleExpanded(): void }) => {
  const [query] = useState(() => { fixture.mounts++; return '보존한 검색어' })
  return <aside><button aria-label={expanded ? '자료 좁게 보기' : '자료 넓게 보기'} onClick={onToggleExpanded}>확대</button><input id="material-search" defaultValue={query} /><button>마지막</button></aside>
} }))
import { RightSidebar } from '../../../src/renderer/src/app/RightSidebar'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'

let root: Root, container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fixture.mounts = 0
  useUiStore.setState({ materialsExpanded: false, materialsExpandedRestoreFocus: true, rightRailOpen: true, rightRailTab: 'materials' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  act(() => root.render(<RightSidebar course={null} />))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

test('expanding keeps one mounted browser, focuses search and restores the trigger on Escape', () => {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="자료 넓게 보기"]')!
  trigger.focus()
  act(() => trigger.click())
  expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
  expect(document.activeElement?.id).toBe('material-search')
  expect(fixture.mounts).toBe(1)
  act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(useUiStore.getState().materialsExpanded).toBe(false)
  expect(document.activeElement).toBe(trigger)
  expect((container.querySelector('#material-search') as HTMLInputElement).value).toBe('보존한 검색어')
  expect(fixture.mounts).toBe(1)
})

test('a context menu consumes the first Escape without dismissing the browser', () => {
  act(() => useUiStore.getState().setMaterialsExpanded(true))
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu')
  container.querySelector('aside')!.append(menu)
  const dismiss = (event: KeyboardEvent): void => { if (event.key === 'Escape') menu.remove() }
  window.addEventListener('keydown', dismiss)
  act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  window.removeEventListener('keydown', dismiss)
  expect(useUiStore.getState().materialsExpanded).toBe(true)
  expect(menu.isConnected).toBe(false)
  act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(useUiStore.getState().materialsExpanded).toBe(false)
})

test('Tab stays in the expanded browser and opening a document does not restore rail focus', () => {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="자료 넓게 보기"]')!
  trigger.focus()
  act(() => trigger.click())
  const last = container.querySelector<HTMLButtonElement>('aside button:last-child')!
  last.focus()
  act(() => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement?.getAttribute('role')).toBe('tab')
  act(() => useUiStore.getState().closeMaterialsExpanded({ returnFocus: false }))
  expect(document.activeElement).not.toBe(trigger)
})
