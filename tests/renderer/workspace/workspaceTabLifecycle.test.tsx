// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DockviewReact, type DockviewApi } from 'dockview'
import { afterEach, expect, test, vi } from 'vitest'
import { WorkspaceTab } from '../../../src/renderer/src/features/workspace/WorkspaceTab'
import { WorkspaceCourseContext } from '../../../src/renderer/src/features/workspace/placementContext'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { BANDAL_TAB_DRAG_MIME } from '../../../src/renderer/src/features/workspace/tabDrag'
import { applyWorkspaceLayout } from '../../../src/renderer/src/features/workspace/workspaceLayout'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(async () => ({})), onPush: vi.fn(() => () => {}) }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
vi.stubGlobal('cancelAnimationFrame', clearTimeout)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const roots: Root[] = []
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  tabDragSession.end()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function workspace(count = 2) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root)
  let api!: DockviewApi
  await act(async () => root.render(
    <WorkspaceCourseContext.Provider value="source">
      <DockviewReact disableAutoResizing components={{ note: () => <div /> }} defaultTabComponent={WorkspaceTab}
        onReady={event => { api = event.api; api.layout(1000, 700) }} />
    </WorkspaceCourseContext.Provider>
  ))
  await act(async () => {
    for (let index = 0; index < count; index++) api.addPanel({
      id: `note-${index}`, component: 'note', title: `Note ${index}`,
      params: { descriptor: { kind: 'note', payload: { courseId: 'source', relPath: `note-${index}.md` } } }
    })
  })
  return { api, host }
}

function tab(host: HTMLElement, index = 0): HTMLElement {
  return [...host.querySelectorAll<HTMLElement>('.dv-tab')].find(node => node.textContent?.includes(`Note ${index}`))!
}

function drag(element: HTMLElement): string | undefined {
  const data = new Map<string, string>()
  const writes: string[] = []
  const dataTransfer = {
    setData: (type: string, value: string) => { writes.push(type); data.set(type, value) },
    setDragImage: () => {}, items: { length: 0 }, effectAllowed: 'none'
  }
  const event = new Event('dragstart', { bubbles: true, cancelable: true })
  Object.assign(event, { dataTransfer })
  act(() => { element.dispatchEvent(event) })
  expect(writes.filter(type => type === BANDAL_TAB_DRAG_MIME)).toHaveLength(data.has(BANDAL_TAB_DRAG_MIME) ? 1 : 0)
  return data.get(BANDAL_TAB_DRAG_MIME)
}

function expectTrustedDrag(host: HTMLElement, index = 0): void {
  const payload = drag(tab(host, index))
  expect(payload).toBeDefined()
  const source = tabDragSession.getSource()
  expect(source).toEqual({ courseId: 'source', panelId: `note-${index}`, nonce: expect.any(String) })
  expect(JSON.parse(payload!).source).toEqual(source)
  act(() => tabDragSession.end())
}

test('moving a live header into another group binds its replacement wrapper and releases the old one', async () => {
  const { api, host } = await workspace()
  const originalTab = tab(host)
  const header = originalTab.querySelector('.workspace-tab')
  expectTrustedDrag(host)
  await act(async () => api.getPanel('note-0')!.api.moveTo({ group: api.addGroup({ direction: 'right' }) }))
  expect(tab(host)).not.toBe(originalTab)
  expect(tab(host).querySelector('.workspace-tab')).toBe(header)
  expectTrustedDrag(host)
  expect(drag(originalTab)).toBeUndefined()
  expect(tabDragSession.getSource()).toBeNull()
})

test('reordering an inactive tab in its own group restores keyboard navigation and ARIA on the new wrapper', async () => {
  const { api, host } = await workspace()
  const originalTab = tab(host)
  await act(async () => api.getPanel('note-0')!.api.moveTo({ index: 1, skipSetActive: true }))
  const movedTab = tab(host)
  expect(movedTab).not.toBe(originalTab)
  expect(movedTab.getAttribute('role')).toBe('tab')
  expect(movedTab.getAttribute('aria-label')).toBe('Note 0')
  expect(movedTab.getAttribute('aria-selected')).toBe('false')
  expect(movedTab.tabIndex).toBe(-1)
  expectTrustedDrag(host)
  const key = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
  act(() => { movedTab.dispatchEvent(key) })
  expect(key.defaultPrevented).toBe(true)
  expect(api.activePanel?.id).toBe('note-0')
  expect(movedTab.getAttribute('aria-selected')).toBe('true')
  expect(movedTab.tabIndex).toBe(0)
  expect(document.activeElement).toBe(movedTab)
  expect(tab(host, 1).getAttribute('aria-selected')).toBe('false')
})

test('restoring a layout with the same descriptor identity keeps subsequent drags working', async () => {
  const { api, host } = await workspace()
  expectTrustedDrag(host)
  for (let attempt = 0; attempt < 3; attempt++) {
    await act(async () => api.fromJSON(api.toJSON(), { reuseExistingPanels: true }))
    expectTrustedDrag(host)
  }
})

test('merging a whole group restores every inactive header even when Dockview omits panel-move events', async () => {
  const { api, host } = await workspace(4)
  const source = api.groups[0]!
  let destination!: typeof source
  await act(async () => {
    destination = api.addGroup({ direction: 'right' })
    api.getPanel('note-3')!.api.moveTo({ group: destination })
  })
  const originalTabs = [0, 1, 2].map(index => tab(host, index))
  await act(async () => source.api.moveTo({ group: destination }))
  expect(api.groups).toHaveLength(1)
  for (const index of [0, 1, 2]) {
    const current = tab(host, index)
    expect(current).not.toBe(originalTabs[index])
    expect(current.getAttribute('role')).toBe('tab')
    expect(current.getAttribute('aria-label')).toBe(`Note ${index}`)
    expect(current.getAttribute('aria-selected')).toBe(String(api.activePanel?.id === `note-${index}`))
    expectTrustedDrag(host, index)
    expect(drag(originalTabs[index]!)).toBeUndefined()
    expect(tabDragSession.getSource()).toBeNull()
  }
  const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
  act(() => { tab(host).dispatchEvent(key) })
  expect(key.defaultPrevented).toBe(true)
  expect(api.activePanel?.id).toBe('note-1')
  expect(document.activeElement).toBe(tab(host, 1))
})

test('layout reconstruction keeps drags working when Dockview coalesces same-millisecond React updates', async () => {
  const { api, host } = await workspace()
  // Dockview's React bridge uses Date.now() as its update state. Binding must
  // follow completed DOM moves even if a subsequent update does not render.
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  for (const preset of ['grid', 'single', 'columns', 'rows'] as const) {
    await act(async () => applyWorkspaceLayout(api, preset))
    expectTrustedDrag(host)
    expect(tab(host).getAttribute('role')).toBe('tab')
  }
})
