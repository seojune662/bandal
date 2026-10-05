// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useTourAnchor } from '../../../src/renderer/src/features/onboarding/tour/useTourAnchor'
let root: ReturnType<typeof createRoot>
let mount: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount)
})
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.useRealTimers(); vi.restoreAllMocks() })
function Probe(): JSX.Element { const anchor = useTourAnchor('english-tool'); return <span>{anchor === null ? 'centered explanation' : 'anchored explanation'}</span> }
test('a missing entry remains available as a centered explanation even after the old skip deadline', () => {
  act(() => root.render(<Probe />)); act(() => { vi.advanceTimersByTime(6_000) })
  expect(mount.textContent).toBe('centered explanation')
  const anchor = document.createElement('div'); anchor.dataset.tour = 'english-tool'
  vi.spyOn(anchor, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ x: 50, y: 50, top: 50, left: 50, right: 150, bottom: 150, width: 100, height: 100, toJSON() {} })
  document.body.append(anchor); act(() => { vi.advanceTimersByTime(200) })
  expect(mount.textContent).toBe('anchored explanation')
  anchor.remove(); act(() => { vi.advanceTimersByTime(200) })
  expect(mount.textContent).toBe('centered explanation')
})
