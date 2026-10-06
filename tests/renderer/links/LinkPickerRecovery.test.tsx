// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
vi.mock('../../../src/renderer/src/features/browser/webviewPassthrough', () => ({ acquirePointerPassthrough: () => () => {} }))
import { LinkPickerDialog } from '../../../src/renderer/src/features/links/LinkPickerDialog'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const close = vi.fn()
const files = [{ relPath: 'target.md', name: 'target.md', kind: 'note' }]
beforeEach(() => {
  invokeMock.mockReset(); close.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
async function render() { await act(async () => root.render(<LinkPickerDialog courseId="course" sourceRelPath="source.md" onClose={close} />)) }
function target() { return Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('target.md'))! }
test('keeps candidates available after a failed link creation so the user can retry', async () => {
  let attempts = 0
  invokeMock.mockImplementation(async channel => {
    if (channel === 'materials:tree') return files
    if (channel === 'links:create' && attempts++ === 0) throw new Error('disk unavailable')
    return {}
  })
  await render()
  await act(async () => target().click())
  expect(host.querySelector('[role=alert]')).not.toBeNull()
  expect(target()).toBeDefined()
  await act(async () => target().click())
  expect(close).toHaveBeenCalledOnce()
})
test('a failed candidate load can be retried without closing the dialog', async () => {
  invokeMock.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(files)
  await render()
  const retry = Array.from(host.querySelectorAll('button')).find(button => /다시 불러오기|Reload/.test(button.textContent ?? ''))
  expect(retry).toBeDefined()
  await act(async () => retry!.click())
  expect(target()).toBeDefined()
})
