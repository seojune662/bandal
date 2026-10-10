// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/useViewportBounds', () => ({ useViewportBounds: () => {} }))
import { FavoritesSection } from '../../../src/renderer/src/features/courses/FavoritesSection'
import { useFavoritesStore, resetFavoritesStoreForTests } from '../../../src/renderer/src/stores/favoritesStore'
import type { Favorite } from '../../../src/shared/types/favorite'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const favorite = (id: string, courseId = 'c1'): Favorite => ({ id, courseId, label: id, descriptor: { kind: 'board', payload: {} }, sortOrder: 0, createdAt: '', updatedAt: '' })
beforeEach(() => {
  invokeMock.mockReset(); resetFavoritesStoreForTests()
  useFavoritesStore.setState({ byCourse: { c1: [favorite('One'), favorite('Two')], c2: [] } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
async function render(courseId = 'c1') { await act(async () => root.render(<FavoritesSection courseId={courseId} />)) }
async function input(selector: string, value: string) { await act(async () => { const node = host.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function submit(selector: string) { await act(async () => host.querySelector(selector)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
test('existing generic website favorites show their site and retain the editable saved name', async () => {
  const saved: Favorite = { ...favorite('etl'), label: '마이페이지', descriptor: { kind: 'browser', payload: { tabId: 'etl', initialUrl: 'https://myetl.snu.ac.kr/' } } }
  useFavoritesStore.setState({ byCourse: { c1: [saved] } })
  await render()
  expect(host.querySelector('.favorite-row__open')?.textContent).toBe('myetl.snu.ac.kr · 마이페이지')
  await act(async () => host.querySelector<HTMLButtonElement>('[title="이름 변경"]')!.click())
  expect(host.querySelector<HTMLInputElement>('.favorite-rename-popover input')?.value).toBe('마이페이지')
})
test('a prior scope link completion leaves the new scope draft intact', async () => {
  let finish!: (value: unknown) => void
  invokeMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="링크 추가"]')!.click())
  await input('input[inputmode=url]', 'https://old.example')
  await input('input[placeholder=강의실]', 'Old link')
  await submit('.favorite-link-form')
  expect(invokeMock).toHaveBeenCalledWith('favorites:add', expect.objectContaining({ courseId: 'c1' }))
  await render('c2')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="링크 추가"]')!.click())
  await input('input[inputmode=url]', 'https://new.example')
  await act(async () => finish(favorite('created')))
  expect(host.querySelector<HTMLInputElement>('input[inputmode=url]')?.value).toBe('https://new.example')
})
test('an older rename completion cannot close another favorite rename form', async () => {
  let finish!: (value: unknown) => void
  invokeMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await render()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="One 이름 변경"]')!.click())
  await input('.favorite-rename-popover input', 'Updated one')
  await submit('.favorite-rename-popover')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Two 이름 변경"]')!.click())
  await input('.favorite-rename-popover input', 'Two draft')
  await act(async () => finish({ ...favorite('One'), label: 'Updated one' }))
  expect(host.querySelector<HTMLInputElement>('.favorite-rename-popover input')?.value).toBe('Two draft')
})

test('an old scope save failure does not put its error on the newly selected scope', async () => {
  let fail!: (error: Error) => void
  invokeMock.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
  await render()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="링크 추가"]')!.click())
  await input('input[inputmode=url]', 'https://old.example')
  await input('input[placeholder=강의실]', 'Old link')
  await submit('.favorite-link-form')
  expect(invokeMock).toHaveBeenCalledWith('favorites:add', expect.objectContaining({ courseId: 'c1' }))
  await render('c2')
  await act(async () => fail(new Error('old scope failed')))
  expect(host.querySelector('[role=alert]')).toBeNull()
})
