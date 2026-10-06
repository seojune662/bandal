// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FeedbackDialog } from '../../../src/renderer/src/features/help/FeedbackDialog'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), copy: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn(), showToastWithAction: vi.fn() }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useT: () => (key: string) => key }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
beforeEach(async () => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<FeedbackDialog initiallyOpen />))
  await act(async () => Simulate.change(host.querySelector('textarea')!, { target: { value: '작성한 의견' } } as never))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

test.each(['rate-limited', 'unavailable'])('keeps a %s draft and allows a successful retry', async reason => {
  mocks.invoke.mockResolvedValueOnce({ ok: false, reason }).mockResolvedValueOnce({ ok: true })
  mocks.copy.mockResolvedValue(undefined)
  await act(async () => Simulate.submit(host.querySelector('form')!))
  expect(host.querySelector('textarea')?.value).toBe('작성한 의견')
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  expect(host.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false)
  await act(async () => Simulate.submit(host.querySelector('form')!))
  expect(mocks.invoke.mock.calls[1]?.[1].body).toBe('작성한 의견')
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})

test('a clipboard failure is not reported as a successful copy and preserves the draft', async () => {
  mocks.invoke.mockRejectedValue(new Error('offline'))
  mocks.copy.mockRejectedValue(new Error('denied'))
  await act(async () => Simulate.submit(host.querySelector('form')!))
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('feedback.unavailableCopyFailed')
  expect(host.querySelector('textarea')?.value).toBe('작성한 의견')
})
