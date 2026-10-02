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

test('only the latest bounds waiting on page creation reach main', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const page = attachNativePage(document.createElement('div'), 'tab', false, null)
  page.bounds({ x: 1, y: 2, width: 300, height: 400 })
  page.bounds(null, true)
  resolve({ state: { id: 41 }, adopted: false })
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('browser:pageBounds', { tabId: 'tab', bounds: null, preview: true }))
  expect(mocks.invoke.mock.calls.filter(call => call[0] === 'browser:pageBounds')).toHaveLength(1)
  page.dispose()
})
test('a late preview cannot cover a page that has already been shown again', async () => {
  let resolve!: (value: unknown) => void
  const element = document.createElement('div')
  const page = attachNativePage(element, 'tab', false, null)
  await page.handle.focus()
  mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  page.bounds(null, true)
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  page.bounds({ x: 0, y: 0, width: 100, height: 100 })
  resolve({ snapshot: 'data:image/png;base64,old' })
  await Promise.resolve(); await Promise.resolve()
  expect(element.style.backgroundImage).toBe('')
  page.dispose()
})
