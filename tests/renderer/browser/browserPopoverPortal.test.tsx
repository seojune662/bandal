// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BrowserDiagnosticsPanel } from '../../../src/renderer/src/features/browser/BrowserDiagnosticsPanel'
import { BrowserDownloadsPanel } from '../../../src/renderer/src/features/browser/BrowserDownloadsPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function mount(node: React.ReactNode): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(node))
  return container
}

describe('browser toolbar popovers', () => {
  test('portals downloads to body at the button anchor and closes on blur', () => {
    const onClose = vi.fn()
    const host = mount(
      <BrowserDownloadsPanel
        anchor={new DOMRect(100, 20, 30, 40)}
        onClose={onClose}
      />
    )
    const panel = document.body.querySelector<HTMLElement>('.browser-downloads')

    expect(panel).not.toBeNull()
    expect(host.contains(panel)).toBe(false)
    expect(panel?.style.top).toBe('60px')
    expect(panel?.style.right).toBe(`${window.innerWidth - 130}px`)

    act(() => window.dispatchEvent(new Event('blur')))
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('portals diagnostics to body and closes on an outside pointer', () => {
    const onClose = vi.fn()
    const host = mount(
      <BrowserDiagnosticsPanel
        tabId="browser:one"
        anchor={new DOMRect(200, 30, 40, 50)}
        onClose={onClose}
      />
    )
    const panel = document.body.querySelector<HTMLElement>(
      '.browser-diagnostics'
    )

    expect(panel).not.toBeNull()
    expect(host.contains(panel)).toBe(false)
    act(() => window.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
