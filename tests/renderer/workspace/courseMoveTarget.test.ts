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
