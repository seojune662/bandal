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
  dispose = installWorkspaceNativePassthrough(document)
}
function pointer(selector: string, type: string, button = 0): void {
  document.querySelector(selector)!.dispatchEvent(new MouseEvent(type, { bubbles: true, button }))
}

test('a tab press suppresses native pages synchronously before dragstart and a click releases them', () => {
  fixture()
  pointer('.dv-tab span', 'pointerdown')
  expect(tabDragSession.getSnapshot()).toBeNull()
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('browser:setHostOccluded', { occluded: true })
  expect(isPointerPassthroughActive()).toBe(true)
  pointer('.dv-tab span', 'pointerup')
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

test('controls, right-clicks and content presses do not obscure native pages', () => {
  fixture()
  pointer('.dv-tab button', 'pointerdown')
  pointer('.dv-tab span', 'pointerdown', 2)
  pointer('.content', 'pointerdown')
  expect(ipc.invoke).not.toHaveBeenCalled()
})

test('canceled pending gestures and disposal release only their own passthrough token', () => {
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
  pointer('.dv-tab span', 'pointerdown')
  dispose?.()
  dispose = undefined
  expect(isPointerPassthroughActive()).toBe(true)
  releaseOverlay()
  expect(isPointerPassthroughActive()).toBe(false)
})
