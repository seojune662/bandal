// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { canAutoFocusNote } from '../../../src/renderer/src/features/notes/noteAutoFocus'

afterEach(() => document.body.replaceChildren())

function visibleEditor(): HTMLDivElement {
  const root = document.createElement('div')
  document.body.append(root)
  vi.spyOn(root, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  return root
}

test('a note opened from an unchanged material control can focus its body', () => {
  const row = document.createElement('button')
  document.body.append(row)
  row.focus()
  expect(canAutoFocusNote(visibleEditor(), row)).toBe(true)
})

test('a note finishing initialization never steals the tab bar arrow-key focus', () => {
  const root = visibleEditor()
  const initial = document.activeElement
  const tab = document.createElement('div')
  tab.setAttribute('role', 'tab')
  tab.tabIndex = 0
  document.body.append(tab)
  tab.focus()
  expect(canAutoFocusNote(root, initial)).toBe(false)
  expect(canAutoFocusNote(root, tab)).toBe(false)
})

test('later focus in a search field or in the editor keeps the user selection', () => {
  const root = visibleEditor()
  const initial = document.activeElement
  const search = document.createElement('input')
  document.body.append(search)
  search.focus()
  expect(canAutoFocusNote(root, initial)).toBe(false)
  root.tabIndex = 0
  root.focus()
  expect(canAutoFocusNote(root, initial)).toBe(false)
})

test('a hidden or unmounted note cannot autofocus after a tab change', () => {
  const root = visibleEditor()
  root.remove()
  expect(canAutoFocusNote(root, document.activeElement)).toBe(false)
  document.body.append(root)
  vi.mocked(root.getClientRects).mockReturnValue([] as unknown as DOMRectList)
  expect(canAutoFocusNote(root, document.activeElement)).toBe(false)
})
