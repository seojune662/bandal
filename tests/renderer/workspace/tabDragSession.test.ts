// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import {
  installWorkspaceDragSession,
  tabDragSession
} from '../../../src/renderer/src/features/workspace/tabDragSession'
import { setWorkspaceTabDragImage } from '../../../src/renderer/src/features/workspace/tabDrag'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  tabDragSession.end()
  document.body.replaceChildren()
})

function fixture(): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML =
    '<div class="dv-tabs-and-actions-container"><div class="dv-tab"><span>Page</span></div></div><div class="dv-sash"></div><div data-material-row></div>'
  document.body.append(root)
  dispose = installWorkspaceDragSession(root)
  return root
}

test('tab DnD survives pointer cancellation and ends on Escape', () => {
  const root = fixture()
  root
    .querySelector('.dv-tab')!
    .dispatchEvent(new Event('dragstart', { bubbles: true }))
  expect(tabDragSession.getSnapshot()).toBe('tab')
  window.dispatchEvent(new Event('pointercancel'))
  expect(tabDragSession.getSnapshot()).toBe('tab')
  expect(root.dataset.tabDragging).toBe('true')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(tabDragSession.getSnapshot()).toBeNull()
  expect(root.dataset.tabDragging).toBeUndefined()
})

test('native file uploads and prevented drags never suppress browser pages', () => {
  const root = fixture()
  root
    .querySelector('[data-material-row]')!
    .dispatchEvent(new Event('dragstart', { bubbles: true }))
  expect(tabDragSession.getSnapshot()).toBeNull()
  const event = new Event('dragstart', { bubbles: true, cancelable: true })
  event.preventDefault()
  root.querySelector('.dv-tab')!.dispatchEvent(event)
  expect(tabDragSession.getSnapshot()).toBeNull()
})

test('sash resizing ends on pointer release and unmount clears listeners', () => {
  const root = fixture()
  const start = () =>
    root
      .querySelector('.dv-sash')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }))
  start()
  expect(tabDragSession.getSnapshot()).toBe('resize')
  window.dispatchEvent(new Event('pointerup'))
  expect(tabDragSession.getSnapshot()).toBeNull()
  start()
  dispose?.()
  expect(tabDragSession.getSnapshot()).toBeNull()
  start()
  expect(tabDragSession.getSnapshot()).toBeNull()
})

test('drag image contains the title and icon without interactive tab controls', () => {
  const source = document.createElement('div')
  source.innerHTML =
    '<svg class="workspace-tab__kind"></svg><span>Old title</span><button>Close</button>'
  let preview: HTMLElement | undefined
  setWorkspaceTabDragImage(
    {
      setDragImage: (element: HTMLElement) => {
        preview = element
      }
    } as unknown as DataTransfer,
    source,
    'Current page'
  )
  expect(preview?.textContent).toBe('Current page')
  expect(preview?.querySelector('button')).toBeNull()
  expect(preview?.querySelector('svg')).not.toBeNull()
})
