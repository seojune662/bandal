// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest'
import type { DockviewApi } from 'dockview'
import { courseMoveTarget } from '../../../src/renderer/src/features/workspace/CourseTabMoveOverlay'

function rect(element: HTMLElement, x: number, y: number, width: number, height: number) {
  element.getBoundingClientRect = () => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) })
}
let root: HTMLElement, group: HTMLElement, content: HTMLElement, api: DockviewApi
beforeEach(() => {
  root = document.createElement('div'); rect(root, 100, 50, 900, 600)
  group = document.createElement('div'); rect(group, 100, 50, 900, 600)
  const header = document.createElement('div'); header.className = 'dv-tabs-and-actions-container'; rect(header, 100, 50, 900, 44)
  header.innerHTML = '<div class="dv-tabs-container"><div class="dv-tab"></div><div class="dv-tab"></div></div>'
  const tabs = header.querySelectorAll<HTMLElement>('.dv-tab'); rect(tabs[0]!, 160, 50, 120, 44); rect(tabs[1]!, 280, 50, 120, 44)
  content = document.createElement('div'); content.className = 'dv-content-container'; rect(content, 100, 94, 900, 556)
  group.append(header, content); root.append(group)
  api = { panels: [{}, {}], groups: [{ id: 'group', element: group, panels: [{}, {}] }] } as unknown as DockviewApi
})

test('center and edge previews use actual content bounds and exclude the tab strip', () => {
  expect(courseMoveTarget(api, root, 550, 350)).toMatchObject({ x: 0, y: 44, width: 900, height: 556, position: { groupId: 'group', direction: 'within' } })
  expect(courseMoveTarget(api, root, 995, 350)).toMatchObject({ x: 450, y: 44, width: 450, height: 556, position: { groupId: 'group', direction: 'right' } })
  expect(courseMoveTarget(api, root, 550, 98)).toMatchObject({ x: 0, y: 44, width: 900, height: 278, position: { groupId: 'group', direction: 'above' } })
})

test('tab-strip insertion is narrow and follows visible tab order', () => {
  expect(courseMoveTarget(api, root, 170, 70)).toMatchObject({ y: 0, width: 4, height: 44, position: { groupId: 'group', direction: 'within', index: 0 } })
  expect(courseMoveTarget(api, root, 310, 70)).toMatchObject({ position: { groupId: 'group', direction: 'within', index: 1 } })
  expect(courseMoveTarget(api, root, 980, 70)).toMatchObject({ position: { groupId: 'group', direction: 'within', index: 2 } })
})

test('hidden overflow tabs keep their real order but never supply zero-sized marker bounds', () => {
  const list = group.querySelector('.dv-tabs-container')!
  const extra = document.createElement('div'); extra.className = 'dv-tab'; list.append(extra)
  const tabs = list.querySelectorAll<HTMLElement>('.dv-tab')
  rect(tabs[1]!, 0, 0, 0, 0)
  rect(extra, 280, 50, 120, 44)
  api = { ...api, groups: [{ id: 'group', element: group, panels: [{}, {}, {}] }] } as unknown as DockviewApi
  expect(courseMoveTarget(api, root, 290, 70)).toMatchObject({ x: 178, position: { index: 2 } })
  rect(extra, 0, 0, 0, 0)
  expect(courseMoveTarget(api, root, 980, 70)).toMatchObject({ x: 178, position: { index: 1 } })
})

test('dropping after a visible active tab inserts before its hidden successors', () => {
  const list = group.querySelector('.dv-tabs-container')!
  for (let index = 2; index < 100; index++) {
    const tab = document.createElement('div'); tab.className = 'dv-tab'
    rect(tab, 0, 0, 0, 0); list.append(tab)
  }
  const active = list.querySelectorAll<HTMLElement>('.dv-tab')[50]!
  rect(active, 400, 50, 36, 44)
  api = { ...api, groups: [{ id: 'group', element: group, panels: Array.from({ length: 100 }, () => ({})) }] } as unknown as DockviewApi
  expect(courseMoveTarget(api, root, 431, 70)).toMatchObject({ x: 334, position: { index: 51 } })
})

test('a missing or zero-sized direct content area never falls back to a header-sized preview', () => {
  content.remove()
  const nested = document.createElement('section'), misleading = document.createElement('div')
  misleading.className = 'dv-content-container'; rect(misleading, 100, 50, 450, 44); nested.append(misleading); group.append(nested)
  expect(courseMoveTarget(api, root, 550, 350)).toBeNull()
  group.append(content); rect(content, 100, 94, 0, 0)
  expect(courseMoveTarget(api, root, 550, 350)).toBeNull()
})

test('empty workspaces accept their full canvas; external or invalid coordinates are rejected', () => {
  const empty = { panels: [], groups: [] } as unknown as DockviewApi
  expect(courseMoveTarget(empty, root, 550, 350)).toMatchObject({ x: 0, y: 0, width: 900, height: 600, position: undefined })
  expect(courseMoveTarget(empty, root, 99, 350)).toBeNull()
  expect(courseMoveTarget(empty, root, Number.NaN, 350)).toBeNull()
})

test('groups from another retained workspace cannot supply the target geometry', () => {
  group.remove()
  expect(courseMoveTarget(api, root, 550, 350)).toBeNull()
})

test('only the shared 36 px content edge requests a split', () => {
  expect(courseMoveTarget(api, root, 136, 350)?.position?.direction).toBe('left')
  expect(courseMoveTarget(api, root, 137, 350)?.position?.direction).toBe('within')
  expect(courseMoveTarget(api, root, 963, 350)?.position?.direction).toBe('within')
  expect(courseMoveTarget(api, root, 964, 350)?.position?.direction).toBe('right')
})

test('an empty retained pane remains a distinct placement target in a multi-pane layout', () => {
  const empty = document.createElement('div'), emptyContent = document.createElement('div')
  emptyContent.className = 'dv-content-container'
  rect(group, 100, 50, 450, 600); rect(content, 100, 94, 450, 556)
  rect(empty, 550, 50, 450, 600); rect(emptyContent, 550, 94, 450, 556)
  empty.append(emptyContent); root.append(empty)
  api = { panels: [], groups: [{ id: 'empty-left', element: group, panels: [] }, { id: 'empty-right', element: empty, panels: [] }] } as unknown as DockviewApi
  expect(courseMoveTarget(api, root, 750, 300)?.position).toEqual({ groupId: 'empty-right', direction: 'within' })
  expect(courseMoveTarget(api, root, 990, 300)?.position).toEqual({ groupId: 'empty-right', direction: 'right' })
})
