// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import type { DockviewPanelApi } from 'dockview'
import { useHasBeenShown } from '../../../src/renderer/src/features/workspace/useHasBeenShown'

test('a visible unfocused split loads; a hidden tab stays lazy and remains loaded after visiting', () => {
  let activeCallback = () => {}, visibleCallback = () => {}
  const api = { isActive: false, isVisible: false,
    onDidActiveChange: (fn: () => void) => { activeCallback = fn; return { dispose() {} } },
    onDidVisibilityChange: (fn: () => void) => { visibleCallback = fn; return { dispose() {} } }
  }
  function Panel() { return <span>{useHasBeenShown(api as unknown as DockviewPanelApi) ? 'loaded' : 'waiting'}</span> }
  const container = document.createElement('div'), root = createRoot(container)
  act(() => root.render(<Panel />))
  expect(container.textContent).toBe('waiting')
  act(() => { api.isVisible = true; visibleCallback() })
  expect(container.textContent).toBe('loaded')
  act(() => { api.isVisible = false; visibleCallback(); activeCallback() })
  expect(container.textContent).toBe('loaded')
  act(() => root.unmount())
})
