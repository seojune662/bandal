// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ScreenSelectionApp } from '../../../src/renderer/src/features/overlay/ScreenSelectionApp'
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
beforeEach(() => { vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

test('a failed screen read shows a visible error and an operable cancel button', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('read failed')).mockResolvedValue({})
  await act(async () => root.render(<ScreenSelectionApp />))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('화면을 불러오지 못했어요')
  await act(async () => host.querySelector('button')!.click())
  expect(mocks.invoke).toHaveBeenLastCalledWith('assistant:selection', { action: 'cancel' })
})

test('right clicks and cancelled pointer drags never commit a screen selection', async () => {
  mocks.invoke.mockResolvedValue({ image: 'data:image/png;base64,fixture' })
  await act(async () => root.render(<ScreenSelectionApp />))
  const overlay = host.querySelector<HTMLDivElement>('.screen-selection')!
  overlay.setPointerCapture = vi.fn()
  await act(async () => {
    Simulate.pointerDown(overlay, { button: 2, clientX: 10, clientY: 10, pointerId: 1 })
    Simulate.pointerUp(overlay, { clientX: 30, clientY: 30 })
    Simulate.pointerDown(overlay, { button: 0, clientX: 10, clientY: 10, pointerId: 2 })
    Simulate.pointerCancel(overlay)
    Simulate.pointerUp(overlay, { clientX: 30, clientY: 30 })
  })
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})
