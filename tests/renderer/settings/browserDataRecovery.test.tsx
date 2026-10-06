// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useLocale: () => 'ko-KR' }))
vi.mock('../../../src/renderer/src/features/browser/BrowserProfileSelect', () => ({ BrowserProfileSelect: () => null }))
import { BrowsingDataPanel } from '../../../src/renderer/src/features/settings/BrowsingDataPanel'
import { SavedLoginsSettings } from '../../../src/renderer/src/features/settings/SavedLoginsSettings'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
beforeEach(() => {
  invokeMock.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
test('browsing data errors are visible and each list can be reloaded', async () => {
  invokeMock.mockRejectedValue(new Error('offline'))
  await act(async () => root.render(<BrowsingDataPanel settings={null} />))
  expect(host.querySelectorAll('[role=alert]')).toHaveLength(2)
  expect(host.textContent).not.toContain('아직 없습니다.')
  invokeMock.mockImplementation(async channel => channel === 'browser:sessionSites'
    ? { sites: [{ origin: 'https://portal.example', cookieCount: 1 }] }
    : { permissions: [{ id: 'permission', origin: 'https://portal.example', permission: 'notifications', decision: 'granted', decidedAt: '' }] })
  const retry = Array.from(host.querySelectorAll('button')).filter(button => button.textContent === '다시 불러오기')
  expect(retry).toHaveLength(2)
  await act(async () => { retry.forEach(button => button.click()) })
  expect(host.querySelectorAll('[role=alert]')).toHaveLength(0)
  expect(host.textContent).toContain('https://portal.example')
  expect(host.textContent).toContain('알림 보내기')
})
test('saved login load failures offer a retry instead of claiming the list is empty', async () => {
  invokeMock.mockRejectedValue(new Error('offline'))
  await act(async () => root.render(<SavedLoginsSettings />))
  expect(host.querySelector('[role=alert]')).not.toBeNull()
  expect(host.textContent).not.toContain('저장된 로그인이 없습니다.')
  invokeMock.mockImplementation(async channel => channel === 'credentials:availability' ? { state: 'ready' } : [])
  const retry = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '다시 불러오기')
  expect(retry).toBeDefined()
  await act(async () => retry!.click())
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(host.textContent).toContain('저장된 로그인이 없습니다.')
})
