import { expect, test, vi } from 'vitest'
import type { DockviewApi } from 'dockview'
import { createTabFaviconController, focusVisibleBrowserPanel } from '../../../src/renderer/src/features/browser/browserTabEvents'

test('only a visible matching native browser page selects a pane', () => {
  const active = vi.fn(), hidden = vi.fn()
  const api = { panels: [
    { params: { descriptor: { kind: 'browser', payload: { tabId: 'shown' } } }, api: { isVisible: true, isActive: false, setActive: active } },
    { params: { descriptor: { kind: 'browser', payload: { tabId: 'hidden' } } }, api: { isVisible: false, setActive: hidden } }
  ] } as unknown as DockviewApi
  expect(focusVisibleBrowserPanel(api, 'shown')).toBe(true)
  expect(active).toHaveBeenCalledOnce()
  expect(focusVisibleBrowserPanel(api, 'hidden')).toBe(false)
  expect(focusVisibleBrowserPanel(null, 'shown')).toBe(false)
  expect(hidden).not.toHaveBeenCalled()
})

test('late favicon requests cannot restore another page icon after navigation or disposal', async () => {
  const pending = new Map<string, (icon: string | null) => void>()
  const publish = vi.fn()
  const controller = createTabFaviconController(url => new Promise(resolve => pending.set(url, resolve)), publish)
  controller.update('old'); controller.navigation(); controller.update('new')
  pending.get('new')!('new icon'); await Promise.resolve()
  pending.get('old')!('old icon'); await Promise.resolve()
  expect(publish.mock.calls).toEqual([[null], ['new icon']])
  controller.update('discard'); controller.dispose()
  pending.get('discard')!('discard icon'); await Promise.resolve()
  expect(publish).toHaveBeenLastCalledWith('new icon')
})

test('newer favicon events and failed icon requests use the correct fallback', async () => {
  const publish = vi.fn(), fetch = vi.fn(async () => { throw new Error('unavailable') })
  const controller = createTabFaviconController(fetch, publish)
  controller.update('bad'); await Promise.resolve(); await Promise.resolve()
  expect(publish).toHaveBeenLastCalledWith(null)
  controller.update(undefined)
  expect(fetch).toHaveBeenCalledOnce()
})
