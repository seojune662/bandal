// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { UpdateStatus } from '../../../src/shared/types/update'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), onPush: vi.fn(), prepare: vi.fn(), toast: vi.fn(), actionToast: vi.fn(), settings: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke, onPush: mocks.onPush }))
vi.mock('../../../src/renderer/src/features/updates/prepareUpdateInstall', () => ({ prepareUpdateInstall: mocks.prepare }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useLocale: () => 'ko-KR' }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast, showToastWithAction: mocks.actionToast }))
vi.mock('../../../src/renderer/src/stores/uiStore', () => ({ useUiStore: { getState: () => ({ openSettings: mocks.settings }) } }))
import { RailUpdateButton } from '../../../src/renderer/src/features/updates/RailUpdateButton'
import { useUpdateNotifications } from '../../../src/renderer/src/features/updates/useUpdateNotifications'
import { resetUpdateStoreForTests, useUpdateStore } from '../../../src/renderer/src/stores/updateStore'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
let host: HTMLDivElement
let push!: (status: UpdateStatus) => void
const available: UpdateStatus = { phase: 'available', currentVersion: '1.0.0', version: '1.1.0', notes: null }
const ready: UpdateStatus = { phase: 'ready', currentVersion: '1.0.0', version: '1.1.0' }
beforeEach(() => {
  resetUpdateStoreForTests(); vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  mocks.onPush.mockImplementation((_channel, callback) => { push = callback; return () => {} })
  mocks.prepare.mockResolvedValue(undefined)
})
afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null; document.body.replaceChildren(); resetUpdateStoreForTests(); vi.unstubAllGlobals()
})
async function render(status: UpdateStatus): Promise<void> {
  mocks.invoke.mockResolvedValue(status)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  function Surface(): JSX.Element { useUpdateNotifications(); return <RailUpdateButton /> }
  await act(async () => { root!.render(<Surface />); await Promise.resolve() })
}
function control(): HTMLButtonElement { return host.querySelector<HTMLButtonElement>('.rail-update-button')! }

test.each<UpdateStatus>([
  { phase: 'unsupported', currentVersion: '1.0.0' },
  { phase: 'idle', currentVersion: '1.0.0', lastCheckedAt: null },
  { phase: 'checking', currentVersion: '1.0.0' },
  { phase: 'error', currentVersion: '1.0.0', message: '백그라운드 검사 실패' }
])('hides the rail download action for $phase without a known update', async status => {
  await render(status)
  expect(host.querySelector('.rail-update-button')).toBeNull()
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('update:status', {})
})

test('one rail click downloads once; progress blocks repeats and ready never restarts without a second gesture', async () => {
  await render(available)
  expect(control().getAttribute('aria-label')).toBe('새 버전 1.1.0 다운로드')
  let finish!: (status: UpdateStatus) => void
  mocks.invoke.mockImplementation(channel => channel === 'update:download' ? new Promise<UpdateStatus>(resolve => { finish = resolve }) : Promise.resolve({ ok: true }))
  await act(async () => { control().click(); control().click(); await Promise.resolve() })
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:download')).toHaveLength(1)
  expect(control().disabled).toBe(true)
  await act(async () => push({ phase: 'downloading', currentVersion: '1.0.0', version: '1.1.0', percent: 57 }))
  expect(control().getAttribute('aria-label')).toBe('업데이트 다운로드 중 57%')
  expect(host.querySelector('.rail-update-button__progress circle:last-child')?.getAttribute('stroke-dasharray')).toBe('57 100')
  await act(async () => { push(ready); finish(available); await Promise.resolve() })
  expect(control().getAttribute('aria-label')).toBe('업데이트 적용하고 다시 시작')
  expect(control().disabled).toBe(false)
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(0)
  await act(async () => { control().click(); control().click(); await Promise.resolve() })
  expect(mocks.prepare).toHaveBeenCalledOnce()
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(1)
  expect(control().disabled).toBe(true)
})

test('download failure exposes its details, retry and update settings, and Escape returns focus to the rail', async () => {
  await render(available)
  await act(async () => push({ phase: 'error', currentVersion: '1.0.0', message: '다운로드 연결이 끊겼어요.' }))
  await act(async () => control().click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.textContent).toContain('다운로드 연결이 끊겼어요.')
  expect(document.activeElement?.textContent).toBe('다시 시도')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(control())
  await act(async () => control().click())
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '설정에서 확인')!.click())
  expect(mocks.settings).toHaveBeenCalledExactlyOnceWith('about')
  await act(async () => control().click())
  mocks.invoke.mockResolvedValue(ready)
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '다시 시도')!.click())
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:download')).toHaveLength(1)
  expect(useUpdateStore.getState().status).toEqual(ready)
})

test('failed note saving does not install and leaves an explicit recovery action', async () => {
  await render(ready)
  mocks.prepare.mockRejectedValue(new Error('필기를 저장하지 못해 다시 시작하지 않았어요.'))
  await act(async () => { control().click(); await Promise.resolve() })
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(0)
  expect(control().getAttribute('aria-label')).toBe('업데이트 오류 확인')
  expect(control().disabled).toBe(false)
  expect(mocks.toast).toHaveBeenCalledWith('필기를 저장하지 못해 다시 시작하지 않았어요.', 'danger')
  await act(async () => control().click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('필기를 저장하지 못해 다시 시작하지 않았어요.')
})


test('the existing toast still restarts only after its explicitly announced one-gesture update action', async () => {
  await render(available)
  const announcedUpdate = mocks.actionToast.mock.calls.find(([, action]) => action.label === '업데이트')![1]
  mocks.invoke.mockImplementation(channel => Promise.resolve(channel === 'update:download' ? ready : { ok: true }))
  await act(async () => { announcedUpdate.run(); await Promise.resolve() })
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:download')).toHaveLength(1)
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(1)
  expect(mocks.prepare).toHaveBeenCalledOnce()
})


test('a post-acceptance install failure unlocks the rail error dialog and retry', async () => {
  await render(ready); mocks.invoke.mockResolvedValue({ ok: true })
  await act(async () => { control().click(); await Promise.resolve() })
  expect(control().disabled).toBe(true)
  await act(async () => push({ phase: 'error', currentVersion: '1.0.0', message: '설치가 실패했어요.' }))
  expect(control().disabled).toBe(false)
  expect(control().getAttribute('aria-label')).toBe('업데이트 오류 확인')
  await act(async () => control().click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('설치가 실패했어요.')
  mocks.invoke.mockResolvedValue(ready)
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '다시 시도')!.click())
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:download')).toHaveLength(1)
})


test('a cancelled browser quit exposes recovery while keeping staged update ready for an explicit retry', async () => {
  await render(ready); mocks.invoke.mockResolvedValue({ ok: true })
  await act(async () => { control().click(); await Promise.resolve() })
  expect(control().disabled).toBe(true)
  await act(async () => push({ ...ready, restartCancelled: true }))
  expect(control().disabled).toBe(false)
  expect(control().getAttribute('aria-label')).toBe('업데이트 오류 확인')
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(1)
  await act(async () => control().click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('다시 시작을 취소했어요')
  mocks.invoke.mockImplementation(async () => { push(ready); return { ok: true } })
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === '다시 시도')!.click())
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(2)
  expect(control().disabled).toBe(true)
})
