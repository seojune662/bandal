// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), onPush: vi.fn(() => () => {}) }))
const toast = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
vi.mock('../../../src/renderer/src/app/toast', () => toast)
vi.mock('../../../src/renderer/src/stores/universityStore', () => ({
  useUniversityStore: (select: (state: { services: never[]; init: () => Promise<void> }) => unknown) => select({ services: [], init: async () => {} })
}))
import { ConfirmDialogContext } from '../../../src/renderer/src/components/ui/confirm-dialog-context'
import { WidgetSettingsPanel } from '../../../src/renderer/src/features/settings/WidgetSettingsPanel'

const confirm = vi.fn(async () => true)

afterEach(() => vi.restoreAllMocks())

async function render(email: string | null, disconnect: () => Promise<unknown> = async () => ({ ok: true })) {
  let saved = email
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'mail:state') return { status: saved === null ? 'disconnected' : 'connected', email: saved, experimental: false }
    if (channel === 'mail:disconnect') { await disconnect(); saved = null; return { ok: true } }
    throw new Error(`unexpected ${channel}`)
  })
  const element = document.createElement('div'), root = createRoot(element)
  await act(async () => root.render(
    <ConfirmDialogContext.Provider value={confirm}>
      <WidgetSettingsPanel settings={null} />
    </ConfirmDialogContext.Provider>
  ))
  return { element, unmount: () => act(() => root.unmount()) }
}
const disconnectButton = (element: HTMLElement) => [...element.querySelectorAll('button')].find(button => button.textContent === 'Google 메일 연결 해제')

test('the Google mail disconnect shows only with a saved sign-in, and asks first', async () => {
  const none = await render(null)
  expect(disconnectButton(none.element)).toBeUndefined()
  await none.unmount()

  confirm.mockResolvedValue(false)
  const { element, unmount } = await render('me@example.com')
  try {
    expect(element.textContent).toContain('me@example.com 로그인이 이 기기에 저장되어 있습니다.')
    await act(async () => disconnectButton(element)!.click())
    expect(ipc.invoke).not.toHaveBeenCalledWith('mail:disconnect', {})

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '이 기기에서 Google 메일 연결을 해제할까요?', confirmVariant: 'destructive' }))
    confirm.mockResolvedValue(true)
    await act(async () => disconnectButton(element)!.click())
    expect(ipc.invoke).toHaveBeenCalledWith('mail:disconnect', {})
    expect(disconnectButton(element)).toBeUndefined()
    expect(element.textContent).not.toContain('me@example.com')
  } finally {
    await unmount()
  }
})

test('a disconnect that fails keeps the button and says so', async () => {
  confirm.mockResolvedValue(true)
  toast.showToast.mockReset()
  const { element, unmount } = await render('me@example.com', async () => { throw new Error('EACCES') })
  try {
    await act(async () => disconnectButton(element)!.click())
    expect(toast.showToast).toHaveBeenCalledWith('메일 연결을 해제하지 못했어요. 다시 시도해 주세요.', 'danger')
    expect(disconnectButton(element)).toBeDefined()
  } finally {
    await unmount()
  }
})
