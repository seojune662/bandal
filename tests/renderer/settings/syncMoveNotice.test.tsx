// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), onPush: vi.fn(), push: null as ((view: unknown) => void) | null }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: ipc.invoke, onPush: ipc.onPush }))
const toast = vi.hoisted(() => ({ showToastWithAction: vi.fn() }))
vi.mock('../../../src/renderer/src/app/toast', () => toast)
import { SyncMoveNotice } from '../../../src/renderer/src/features/settings/sync/SyncMoveNotice'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'

const view = (provider: 'icloud' | 'gdrive', t: number) => ({ available: { icloud: false, gdrive: true }, moved: { device: 'iPad Pro', provider, t, account_hint: provider === 'gdrive' ? 'student@example.com' : null } })

test('another device\'s move is told once per move, with the way to Settings › 동기화, and never for a storage this computer cannot use (v2.7)', async () => {
  ipc.invoke.mockResolvedValue(view('gdrive', 1))
  ipc.onPush.mockImplementation((_channel: string, listener: (view: unknown) => void) => {
    ipc.push = listener
    return () => {}
  })
  const openSettings = vi.fn()
  useUiStore.setState({ openSettings })
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<SyncMoveNotice />))
  expect(toast.showToastWithAction).toHaveBeenCalledTimes(1)
  const [message, action] = toast.showToastWithAction.mock.calls[0]!
  expect(message).toBe('iPad Pro에서 Google Drive(student@example.com)로 옮겼어요. 이 기기도 옮길까요?')
  action.run()
  expect(openSettings).toHaveBeenCalledWith('sync')
  // The same move again, and one to iCloud, which this computer cannot use: nothing more.
  await act(async () => ipc.push!(view('gdrive', 1)))
  await act(async () => ipc.push!(view('icloud', 2)))
  expect(toast.showToastWithAction).toHaveBeenCalledTimes(1)
  await act(async () => ipc.push!(view('gdrive', 3)))
  expect(toast.showToastWithAction).toHaveBeenCalledTimes(2)
  act(() => root.unmount())
})
