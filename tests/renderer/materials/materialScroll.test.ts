// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { revealMaterialRow } from '../../../src/renderer/src/features/materials/materialScroll'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function viewport(parent: HTMLElement, width: number, height: number, contentWidth = width, contentHeight = height): HTMLDivElement {
  const element = document.createElement('div')
  element.style.overflowX = 'auto'; element.style.overflowY = 'auto'
  Object.defineProperties(element, {
    clientWidth: { value: width }, clientHeight: { value: height },
    scrollWidth: { value: contentWidth }, scrollHeight: { value: contentHeight }
  })
  parent.append(element)
  return element
}

test('revealing a selected row scrolls only its material body, including after a refresh', () => {
  const outside = viewport(document.body, 800, 600, 1200, 1000)
  const sidebar = document.createElement('aside'); outside.append(sidebar)
  const body = viewport(sidebar, 200, 200, 200, 1000)
  const row = document.createElement('button'); body.append(row)
  outside.scrollTop = 20; outside.scrollLeft = 30
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => new DOMRect(600, 100, 200, 200))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new DOMRect(600, 350 - body.scrollTop, 180, 100))
  revealMaterialRow(row, sidebar)
  expect(body.scrollTop).toBe(150)
  revealMaterialRow(row, sidebar)
  expect(body.scrollTop).toBe(150)
  expect(outside.scrollTop).toBe(20)
  expect(outside.scrollLeft).toBe(30)
})

test('nested column panes retain vertical and horizontal nearest scrolling within the sidebar', () => {
  const sidebar = document.createElement('aside'); document.body.append(sidebar)
  const body = viewport(sidebar, 300, 300, 300, 600)
  const columns = viewport(body, 300, 200, 600, 200)
  const column = viewport(columns, 170, 200, 170, 500)
  const row = document.createElement('button'); column.append(row)
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 300))
  vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 300, 200))
  vi.spyOn(column, 'getBoundingClientRect').mockImplementation(() => new DOMRect(340 - columns.scrollLeft, 50, 170, 200))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new DOMRect(350 - columns.scrollLeft, 350 - column.scrollTop, 150, 40))
  revealMaterialRow(row, sidebar)
  expect(column.scrollTop).toBe(140)
  expect(columns.scrollLeft).toBe(200)
  expect(body.scrollTop).toBe(0)
})

test('an oversized thumbnail row reveals its nearest edge without hiding its title unnecessarily', () => {
  const sidebar = document.createElement('aside'); document.body.append(sidebar)
  const body = viewport(sidebar, 200, 200, 200, 1000)
  const row = document.createElement('button'); body.append(row)
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 200, 200))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 350 - body.scrollTop, 180, 300))
  for (const [initial, expected] of [[0, 250], [500, 350], [300, 300]] as const) {
    body.scrollTop = initial
    revealMaterialRow(row, sidebar)
    expect(body.scrollTop).toBe(expected)
  }
})

test('closed and inactive material panes keep their saved scroll position on tree refresh', () => {
  const sidebar = document.createElement('aside'); document.body.append(sidebar)
  const body = viewport(sidebar, 200, 200, 200, 1000)
  const row = document.createElement('button'); body.append(row)
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 100, 200, 200))
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 700, 180, 100))
  body.scrollTop = 120
  for (const state of ['hidden', 'inert', 'visibility'] as const) {
    sidebar.hidden = state === 'hidden'
    sidebar.toggleAttribute('inert', state === 'inert')
    sidebar.style.visibility = state === 'visibility' ? 'hidden' : 'visible'
    revealMaterialRow(row, sidebar)
    expect(body.scrollTop).toBe(120)
  }
})
