// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MaterialAffordancesProvider, MaterialRowAffordance, positionMaterialPreview } from '../../../src/renderer/src/features/materials/MaterialAffordances'
import { resetWorkspaceStoreForTests, useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { MATERIAL_NEW_DURATION_MS } from '../../../src/renderer/src/features/materials/materialStatus'

const invoke = vi.hoisted(() => vi.fn(async () => []))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke, onPush: vi.fn(() => () => {}) }))
vi.mock('../../../src/renderer/src/features/materials/preview/MaterialPreviewContent', () => ({
  MaterialPreviewContent: ({ node }: { node: { name: string } }) => <div>내용: {node.name}</div>,
  WhiteboardPreviewContent: () => <div>화이트보드 내용</div>
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let host: HTMLDivElement
const click = vi.fn(), drag = vi.fn()
const base = 1_700_000_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(base)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  resetWorkspaceStoreForTests()
  invoke.mockClear(); click.mockClear(); drag.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })

function render(courseId = 'course', addedAt = base): HTMLButtonElement[] {
  act(() => root.render(<MaterialAffordancesProvider courseId={courseId}>
    {['first.md', 'second.md'].map(name => <MaterialRowAffordance key={name} target={{ courseId, node: { name, relPath: name, kind: 'note', addedAt } }}>
      <button title={name} onClick={click} onDragStart={drag}>{name}</button>
    </MaterialRowAffordance>)}
  </MaterialAffordancesProvider>))
  return [...host.querySelectorAll('button')]
}
function enter(button: HTMLButtonElement): void { act(() => { button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) }) }
async function advance(ms: number): Promise<void> { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

test('shows a single card after 450ms and switching rows restarts the delay', async () => {
  const [first, second] = render()
  enter(first!); await advance(449)
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await advance(1)
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('first.md')
  expect(first!.hasAttribute('title')).toBe(false)
  enter(second!); await advance(449)
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await advance(1)
  expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('second.md')
  expect(click).not.toHaveBeenCalled()
  expect(invoke).not.toHaveBeenCalled()
})

test.each(['pointerdown', 'contextmenu', 'dragstart', 'scroll'])('%s dismisses before the existing action', async eventName => {
  const [button] = render()
  enter(button!); await advance(450)
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
  act(() => button!.dispatchEvent(new Event(eventName, { bubbles: true })))
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  if (eventName === 'dragstart') expect(drag).toHaveBeenCalledOnce()
})

test('keyboard focus previews and Escape/course change cancel pending or visible cards', async () => {
  const [button] = render()
  act(() => button!.focus()); await advance(450)
  expect(button!.getAttribute('aria-describedby')).toBe(document.querySelector('[role="tooltip"]')?.id)
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  enter(button!); render('other'); await advance(450)
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

test('new and open states coexist; expiration does not require a reload', async () => {
  act(() => useWorkspaceStore.setState({ activeCourseId: 'course', openTabs: { one: { kind: 'note', payload: { courseId: 'course', relPath: 'first.md' } } } }))
  const [button] = render('course', base - MATERIAL_NEW_DURATION_MS + 100)
  expect(button!.dataset.materialOpen).toBe('true')
  expect(button!.dataset.materialNew).toBe('true')
  expect(button!.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('탭에 열림 · 최근 추가됨')
  await advance(100)
  expect(button!.dataset.materialNew).toBeUndefined()
  expect(button!.dataset.materialOpen).toBe('true')
  act(() => useWorkspaceStore.setState({ openTabs: {} }))
  expect(button!.dataset.materialOpen).toBeUndefined()
})

test('closing a retained materials rail cancels both pending and visible previews', async () => {
  const [button] = render()
  enter(button!)
  await act(async () => host.setAttribute('inert', ''))
  await advance(450)
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  act(() => host.removeAttribute('inert'))
  enter(button!); await advance(450)
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
  await act(async () => host.setAttribute('aria-hidden', 'true'))
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

test('card placement uses left side and remains inside narrow and bottom viewports', () => {
  expect(positionMaterialPreview({ left: 800, right: 1000, top: 40 }, 320, 280, 1024, 800)).toEqual({ left: 472, top: 40 })
  expect(positionMaterialPreview({ left: 10, right: 280, top: 750 }, 304, 280, 320, 800)).toEqual({ left: 8, top: 512 })
})
