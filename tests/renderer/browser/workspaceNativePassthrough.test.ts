// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { installWorkspaceNativePassthrough } from '../../../src/renderer/src/features/browser/workspaceNativePassthrough'
import { acquirePointerPassthrough, isPointerPassthroughActive } from '../../../src/renderer/src/features/browser/webviewPassthrough'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  tabDragSession.end()
  document.body.replaceChildren()
  vi.clearAllMocks()
})
function fixture(): void {
  document.body.innerHTML = '<div class="workspace-host"><div class="dv-tabs-and-actions-container"><div class="dv-tab"><span>Page</span><button>Close</button></div><button>Add</button></div><div class="dv-sash"></div><div class="content"></div></div>'
  dispose = installWorkspaceNativePassthrough()
}
function pointer(selector: string, type: string, button = 0): void {
  document.querySelector(selector)!.dispatchEvent(new MouseEvent(type, { bubbles: true, button }))
}

test('pressing a tab leaves native pages alone until native dragstart owns the pointer', () => {
  fixture()
  pointer('.dv-tab span', 'pointerdown')
  expect(tabDragSession.getSnapshot()).toBeNull()
  expect(ipc.invoke).not.toHaveBeenCalled()
  expect(isPointerPassthroughActive()).toBe(false)
  tabDragSession.beginTab({ courseId: 'source', panelId: 'panel', nonce: 'drag' })
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('browser:setHostOccluded', { occluded: true })
  expect(isPointerPassthroughActive()).toBe(true)
  tabDragSession.end()
  expect(ipc.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: false })
  expect(isPointerPassthroughActive()).toBe(false)
})

test('native pointer cancellation preserves suppression through course changes until the drag ends', () => {
  fixture()
  pointer('.dv-tab span', 'pointerdown')
  tabDragSession.beginTab({ courseId: 'source', panelId: 'panel', nonce: 'drag' })
  pointer('.dv-tab span', 'pointercancel')
  expect(ipc.invoke).toHaveBeenCalledTimes(1)
  document.querySelector('.dv-tab')!.remove()
  expect(isPointerPassthroughActive()).toBe(true)
  tabDragSession.end()
  expect(ipc.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: false })
  expect(isPointerPassthroughActive()).toBe(false)
})

test('session events suppress pages immediately even when no pointer press was observed', () => {
  fixture()
  tabDragSession.begin('group')
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('browser:setHostOccluded', { occluded: true })
  tabDragSession.end()
  expect(ipc.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: false })
})

test('normal tab clicks, controls, right-clicks and content presses do not obscure native pages', () => {
  fixture()
  pointer('.dv-tab span', 'pointerdown')
  pointer('.dv-tab span', 'pointerup')
  pointer('.dv-tab button', 'pointerdown')
  pointer('.dv-tab span', 'pointerdown', 2)
  pointer('.content', 'pointerdown')
  expect(ipc.invoke).not.toHaveBeenCalled()
})

test('aborted presses stay visible and disposal releases only its own passthrough token', () => {
  fixture()
  pointer('.dv-sash', 'pointerdown')
  pointer('.dv-sash', 'pointercancel')
  expect(isPointerPassthroughActive()).toBe(false)
  pointer('.dv-tab span', 'pointerdown')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(isPointerPassthroughActive()).toBe(false)
  pointer('.dv-tab span', 'pointerdown')
  window.dispatchEvent(new Event('blur'))
  expect(isPointerPassthroughActive()).toBe(false)
  const releaseOverlay = acquirePointerPassthrough()
  tabDragSession.begin('resize')
  dispose?.()
  dispose = undefined
  expect(isPointerPassthroughActive()).toBe(true)
  releaseOverlay()
  expect(isPointerPassthroughActive()).toBe(false)
})
