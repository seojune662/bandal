// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), push: vi.fn(), remove: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke, onPush: mocks.push }))
import { attachNativePage } from '../../../src/renderer/src/features/browser/nativePageHandle'
beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.push.mockReturnValue(mocks.remove)
  mocks.invoke.mockImplementation(async channel => channel === 'browser:createPage'
    ? { state: { id: 41, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }, adopted: false }
    : channel === 'browser:pageAction' ? 17 : { snapshot: null })
})
test('page commands and events live on an explicit handle, not its DOM anchor', async () => {
  const element = document.createElement('div')
  const page = attachNativePage(element, 'tab', false, 'course')
  const ready = vi.fn()
  page.handle.addEventListener('native-ready', ready)
  expect(await page.handle.findInPage('text')).toBe(17)
  expect(page.handle.element).toBe(element)
  expect('findInPage' in element).toBe(false)
  expect('loadURL' in element).toBe(false)
  expect(ready).toHaveBeenCalledTimes(1)
  expect(page.handle.getWebContentsId()).toBe(41)
  page.dispose()
  await expect(page.handle.reload()).rejects.toThrow('closed')
})
test('failed native creation rejects commands and reports a visible error once', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('closed profile'))
  const page = attachNativePage(document.createElement('div'), 'tab', false, null)
  const failed = vi.fn()
  page.handle.addEventListener('did-fail-load', failed)
  await expect(page.handle.reload()).rejects.toThrow('closed profile')
  expect(failed).toHaveBeenCalledTimes(1)
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
  page.dispose()
})
