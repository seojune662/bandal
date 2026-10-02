// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), onPush: vi.fn(() => () => {}) }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { AccountPanel } from '../../../src/renderer/src/features/settings/AccountPanel'
import { AccountAvatar } from '../../../src/renderer/src/features/account/AccountAvatar'

test('provider photos fall back on failure and retry when the account photo changes', async () => {
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const render = (url: string | null) => act(() => root.render(<AccountAvatar avatarUrl={url} nickname="learner" />))
  try {
    await render(null)
    expect(element.querySelector('svg')).not.toBeNull()
    await render('https://lh3.googleusercontent.com/one')
    expect(element.querySelector('img')?.getAttribute('src')).toContain('/one')
    await act(() => element.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(element.querySelector('img')).toBeNull()
    expect(element.querySelector('svg')).not.toBeNull()
    await render('https://k.kakaocdn.net/two')
    expect(element.querySelector('img')?.getAttribute('src')).toContain('/two')
    await render(null)
    expect(element.querySelector('img')).toBeNull()
  } finally { await act(() => root.unmount()); element.remove() }
})


test('account settings retain nickname editing without custom avatar controls', async () => {
  ipc.invoke.mockResolvedValue({ phase: 'signed-in', profile: { id: 'one', nickname: 'learner', avatarColor: 'blue', avatarEmoji: '⭐' }, email: 'one@example.test', avatarUrl: 'https://lh3.googleusercontent.com/photo', online: true, errorCode: null })
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(async () => root.render(<AccountPanel />))
    expect(element.querySelector<HTMLInputElement>('.account-nickname-form input')?.value).toBe('learner')
    expect(element.querySelector('.account-avatar img')?.getAttribute('src')).toContain('/photo')
    expect(element.querySelector('.account-avatar-picker')).toBeNull()
    expect(element.textContent).not.toContain('⭐')
    expect(element.textContent).not.toContain('아바타')
  } finally { await act(() => root.unmount()); element.remove() }
})
