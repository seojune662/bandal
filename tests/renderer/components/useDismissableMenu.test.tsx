// @vitest-environment jsdom
import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { useDismissableMenu } from '../../../src/renderer/src/components/useDismissableMenu'
import { useFocusTrap } from '../../../src/renderer/src/components/useFocusTrap'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('menu skips unavailable choices and Escape only dismisses the menu inside a dialog', async () => {
  vi.useFakeTimers()
  const closeDialog = vi.fn(), closeMenu = vi.fn()
  function Harness() {
    const dialog = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null)
    useFocusTrap(dialog, { active: true, onEscape: closeDialog })
    useDismissableMenu(true, menu, closeMenu)
    return <div ref={dialog}><button>menu trigger</button><div ref={menu}><button disabled>disabled</button><button style={{ display: 'none' }}>hidden</button><button>available</button></div></div>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => vi.advanceTimersByTimeAsync(30))
    expect(document.activeElement?.textContent).toBe('available')
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(closeMenu).toHaveBeenCalledTimes(1)
    expect(closeDialog).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent).toBe('menu trigger')
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() }
})
