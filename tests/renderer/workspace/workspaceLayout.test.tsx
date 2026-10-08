// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DockviewReact, type DockviewApi, type IDockviewPanelProps } from 'dockview'
import { afterEach, expect, test, vi } from 'vitest'
import { applyWorkspaceLayout, closeWorkspacePanel, moveWorkspacePanel, removeEmptyWorkspaceGroup,
  splitWorkspaceGroup, workspaceGroupsInVisualOrder } from '../../../src/renderer/src/features/workspace/workspaceLayout'
import { resetPanelContentForTests, WorkspaceContentLayer, WorkspacePanelSlot } from '../../../src/renderer/src/features/workspace/panelContentHost'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
vi.stubGlobal('cancelAnimationFrame', clearTimeout)
const roots: Root[] = []
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  resetPanelContentForTests()
  document.body.replaceChildren()
})

async function workspace(count: number) {
  const host = document.createElement('div'); host.className = 'workspace-host'; document.body.append(host)
  const root = createRoot(host); roots.push(root)
  let api!: DockviewApi
  function Editor(props: IDockviewPanelProps) { return <input data-editor={props.api.id} defaultValue={props.api.id} /> }
  await act(async () => root.render(<>
    <DockviewReact disableAutoResizing defaultRenderer="always" theme={{ name: 'test', className: 'test', gap: 8 }} components={{ note: WorkspacePanelSlot }}
      onReady={event => { api = event.api; api.layout(1000, 700) }} />
    <WorkspaceContentLayer components={{ note: Editor }} activeCourseId={null} active />
  </>))
  await act(async () => {
    for (let index = 0; index < count; index++) api.addPanel({ id: `note-${index}`, component: 'note', title: `Note ${index}`, params: { saved: index } })
  })
  return { api, host }
}

test.each([0, 1, 3, 9])('grid distributes %s tabs in balanced row order and preserves all live panel objects', async count => {
  const { api, host } = await workspace(count)
  const panels = [...api.panels], inputs = [...host.querySelectorAll<HTMLInputElement>('input')]
  const active = api.activePanel
  for (const input of inputs) input.value = `unsaved ${input.dataset.editor}`
  await act(async () => applyWorkspaceLayout(api, 'grid'))
  const groups = workspaceGroupsInVisualOrder(api)
  expect(groups).toHaveLength(4)
  expect(groups.map(group => group.panels.length)).toEqual(Array.from({ length: 4 }, (_, index) => Math.floor(count / 4) + (index < count % 4 ? 1 : 0)))
  expect(groups.flatMap(group => group.panels.map(panel => panel.id))).toEqual(panels.map(panel => panel.id))
  for (const panel of panels) expect(api.getPanel(panel.id)).toBe(panel)
  for (const input of inputs) {
    expect(input.isConnected).toBe(true)
    expect(input.value).toBe(`unsaved ${input.dataset.editor}`)
  }
  if (active) expect(api.activePanel).toBe(active)
  expect(groups[0]!.api.width).toBeCloseTo(groups[1]!.api.width)
  expect(groups[0]!.api.height).toBeCloseTo(groups[2]!.api.height)
  expect(groups[0]!.api.width).toBeCloseTo(496)
  expect(groups[0]!.api.height).toBeCloseTo(346)
  const serialized = api.toJSON()
  await act(async () => api.fromJSON(serialized, { reuseExistingPanels: true }))
  expect(api.groups).toHaveLength(4)
  expect(workspaceGroupsInVisualOrder(api)[0]!.api.width).toBeCloseTo(496)
  for (const panel of panels) expect(api.getPanel(panel.id)).toBe(panel)
})

test('last-tab move and close retain their empty quadrants; explicit removal and preset collapse remove them', async () => {
  const { api } = await workspace(4)
  await act(async () => applyWorkspaceLayout(api, 'grid'))
  const [first, second] = workspaceGroupsInVisualOrder(api)
  await act(async () => { expect(moveWorkspacePanel(api, 'note-0', { groupId: second!.id, index: 1 })).toBe(true) })
  expect(api.getGroup(first!.id)?.panels).toHaveLength(0)
  expect(api.getGroup(second!.id)?.panels.map(panel => panel.id)).toEqual(['note-1', 'note-0'])
  await act(async () => { for (const panel of [...api.panels]) closeWorkspacePanel(api, panel.id) })
  expect(api.groups).toHaveLength(4)
  expect(api.panels).toHaveLength(0)
  await act(async () => { expect(removeEmptyWorkspaceGroup(api, first!.id)).toBe(true) })
  expect(api.groups).toHaveLength(3)
  await act(async () => applyWorkspaceLayout(api, 'single'))
  expect(api.groups).toHaveLength(1)
})

test('splits both axes, correctly reorders within a group, and preserves a moved tab API and draft', async () => {
  const { api, host } = await workspace(3)
  const firstId = api.groups[0]!.id, panel = api.getPanel('note-0')!
  const draft = host.querySelector<HTMLInputElement>('[data-editor="note-0"]')!
  draft.value = 'keep this edit'
  await act(async () => { moveWorkspacePanel(api, 'note-0', { groupId: firstId, index: 3 }) })
  expect(api.getGroup(firstId)!.panels.map(panel => panel.id)).toEqual(['note-1', 'note-2', 'note-0'])
  let rightId: string | null = null
  await act(async () => { rightId = splitWorkspaceGroup(api, firstId, 'right') })
  await act(async () => { splitWorkspaceGroup(api, rightId!, 'below') })
  expect(api.groups).toHaveLength(3)
  await act(async () => { moveWorkspacePanel(api, 'note-0', { groupId: rightId!, direction: 'below' }) })
  expect(api.groups).toHaveLength(4)
  expect(api.getPanel('note-0')).toBe(panel)
  expect(draft.isConnected).toBe(true)
  expect(draft.value).toBe('keep this edit')
  expect(removeEmptyWorkspaceGroup(api, api.getPanel('note-0')!.group.id)).toBe(false)
  await act(async () => applyWorkspaceLayout(api, 'rows'))
  expect(api.groups).toHaveLength(2)
  expect(api.groups[0]!.api.width).toBeCloseTo(api.width)
  await act(async () => applyWorkspaceLayout(api, 'columns'))
  expect(api.groups[0]!.api.height).toBeCloseTo(api.height)
})
