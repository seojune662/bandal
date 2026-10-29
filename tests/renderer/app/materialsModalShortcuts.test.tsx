// @vitest-environment jsdom
import React, { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { useFocusTrap } from '../../../src/renderer/src/components/useFocusTrap'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { useNewTabMenu } from '../../../src/renderer/src/features/workspace/newTabMenuController'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(async () => ({ keybindings: {} })),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))
import { runShortcutAction, useGlobalShortcuts } from '../../../src/renderer/src/app/shortcuts'

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
function mount(element: React.ReactNode): void {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  act(() => root.render(element))
}

function MaterialsPanel(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const expanded = useUiStore(state => state.materialsExpanded)
  useFocusTrap(ref, { active: expanded, onEscape: () => useUiStore.getState().closeMaterialsExpanded() })
  useGlobalShortcuts()
  return <div ref={ref} className="right-sidebar" data-expanded={expanded || undefined}>
    <div id="right-panel-materials"><input id="material-search" /><button>Materials action</button></div>
  </div>
}

function NestedDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, { active: true, onEscape: onClose })
  return <div ref={ref} role="dialog"><input id="note-title" /><button>Save</button></div>
}

function ModalHost(): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  return open ? <NestedDialog onClose={() => setOpen(false)} /> : null
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0).reverse()) {
    act(() => root.unmount())
    container.remove()
  }
  useUiStore.getState().closeMaterialsExpanded()
  vi.restoreAllMocks()
})

test.each(['ctrlKey', 'metaKey'] as const)('%s respects the topmost modal before materials shortcuts or new-tab cycling', async modifier => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useUiStore.getState().setMaterialsExpanded(true)
  const closeTab = vi.spyOn(useWorkspaceStore.getState(), 'closeActiveTab')
  mount(<MaterialsPanel />)
  await act(async () => {})
  mount(<ModalHost />)
  const title = document.querySelector<HTMLInputElement>('#note-title')!
  expect(document.activeElement).toBe(title)

  for (const chord of [
    { key: 'f' }, { key: 'p' }, { key: 'w' }, { key: 't' }, { key: ',' },
    { key: 'b', altKey: true }, { key: 'd', shiftKey: true },
    { key: 'i', shiftKey: true }, { key: 'm', shiftKey: true }
  ]) {
    act(() => title.dispatchEvent(new KeyboardEvent('keydown', { ...chord, [modifier]: true, bubbles: true, cancelable: true })))
    act(() => title.dispatchEvent(new KeyboardEvent('keyup', { key: modifier === 'ctrlKey' ? 'Control' : 'Meta', bubbles: true })))
    expect(document.activeElement).toBe(title)
    expect(useUiStore.getState().materialsExpanded).toBe(true)
    expect(useUiStore.getState().isSettingsOpen).toBe(false)
    expect(useNewTabMenu.getState().isOpen).toBe(false)
    expect(useNewTabMenu.getState().cycleIndex).toBeNull()
    expect(closeTab).not.toHaveBeenCalled()
  }
  // Delayed native-page commands use the same modal guard.
  act(() => runShortcutAction({ type: 'browser-find' }, 'background-browser'))
  expect(document.activeElement).toBe(title)

  act(() => title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(document.querySelector('#note-title')).toBeNull()
  expect(useUiStore.getState().materialsExpanded).toBe(true)
  act(() => runShortcutAction({ type: 'browser-find' }))
  expect(document.activeElement?.id).toBe('material-search')
  act(() => runShortcutAction({ type: 'close-tab' }))
  expect(useUiStore.getState().materialsExpanded).toBe(false)
  expect(closeTab).not.toHaveBeenCalled()
})
