// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), push: vi.fn(), remove: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke, onPush: mocks.push }))
import { attachNativePage } from '../../../src/renderer/src/features/browser/nativePageHandle'
import { installWorkspaceDragSession, tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { installWorkspaceNativePassthrough } from '../../../src/renderer/src/features/browser/workspaceNativePassthrough'
let removeDragSession: (() => void) | undefined
let removePassthrough: (() => void) | undefined
beforeEach(() => {
  tabDragSession.end()
  mocks.invoke.mockReset()
  mocks.push.mockReturnValue(mocks.remove)
  mocks.invoke.mockImplementation(async channel => channel === 'browser:createPage'
    ? { state: { id: 41, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }, adopted: false }
    : channel === 'browser:pageAction' ? 17 : { snapshot: null })
})
afterEach(() => {
  removeDragSession?.()
  removeDragSession = undefined
  removePassthrough?.()
  removePassthrough = undefined
  document.body.replaceChildren()
})
function pressHeader(): void {
  const root = document.createElement('div')
  root.innerHTML = '<div class="dv-tab"><span>Inactive tab</span></div>'
  document.body.append(root)
  removeDragSession = installWorkspaceDragSession(root)
  root.querySelector('span')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
}
const boundsCalls = () => mocks.invoke.mock.calls.filter(call => call[0] === 'browser:pageBounds')
const flushMicrotasks = async () => { for (let index = 0; index < 6; index++) await Promise.resolve() }
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
test('late adoption identifies its navigation snapshot while subsequent real navigations remain live events', async () => {
  const state = { id: 41, url: 'https://accounts.google.com/denied', title: '로그인할 수 없음', loading: false, canGoBack: true, canGoForward: false }
  mocks.invoke.mockResolvedValueOnce({ state, adopted: true })
  const page = attachNativePage(document.createElement('div'), 'tab', false, null)
  const navigate = vi.fn()
  page.handle.addEventListener('did-navigate', navigate)
  await page.handle.focus()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: state.url, isSnapshot: true }))
  const receive = mocks.push.mock.calls.at(-1)![1]
  receive({ tabId: 'tab', name: 'did-navigate', state: { ...state, url: 'https://chatgpt.com/' }, detail: { url: 'https://chatgpt.com/', httpResponseCode: 200 } })
  expect(navigate.mock.calls[1]![0]).not.toHaveProperty('isSnapshot')
  expect(page.handle.getURL()).toBe('https://chatgpt.com/')
  page.dispose()
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
test('course placement updates preserve the native page and use increasing revisions', async () => {
  const page = attachNativePage(document.createElement('div'), 'tab', true, 'source', 'profile')
  await page.course('target')
  await page.course('third')
  const updates = mocks.invoke.mock.calls.filter(call => call[0] === 'browser:setCourse').map(call => call[1])
  expect(updates).toHaveLength(2)
  expect(updates[0]).toMatchObject({ tabId: 'tab', courseId: 'target', expectedWebContentsId: 41 })
  expect(updates[1].revision).toBeGreaterThan(updates[0].revision)
  expect(mocks.invoke.mock.calls.filter(call => call[0] === 'browser:createPage')).toHaveLength(1)
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'browser:destroyPage' || call[0] === 'browser:pageAction')).toBe(false)
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

test('automatic focus rechecks its owner after asynchronous native creation', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const page = attachNativePage(document.createElement('div'), 'tab', false, null)
  let allowed = true
  const pending = page.handle.focus(() => allowed)
  allowed = false
  resolve({ state: { id: 41 }, adopted: false })
  await pending
  expect(mocks.invoke.mock.calls.filter(call => call[0] === 'browser:pageAction')).toHaveLength(0)
  allowed = true
  await page.handle.focus(() => allowed)
  expect(mocks.invoke).toHaveBeenLastCalledWith('browser:pageAction', { tabId: 'tab', action: 'focus', args: [] })
  page.dispose()
})

test('pressing an inactive tab defers both native hide and show until release, applying only their latest placement', async () => {
  const previous = attachNativePage(document.createElement('div'), 'previous', false, null)
  const selected = attachNativePage(document.createElement('div'), 'selected', false, null)
  const bounds = { x: 288, y: 169, width: 448, height: 551 }
  previous.bounds(bounds)
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(1)
  mocks.invoke.mockClear()
  pressHeader()
  previous.bounds(null)
  selected.bounds(bounds)
  selected.bounds({ ...bounds, width: 450 })
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(0)
  expect(tabDragSession.getSnapshot()).toBeNull()
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
  await flushMicrotasks()
  expect(boundsCalls()).toEqual([
    ['browser:pageBounds', { tabId: 'previous', bounds: null, preview: false }],
    ['browser:pageBounds', { tabId: 'selected', bounds: { ...bounds, width: 450 }, preview: false }]
  ])
  previous.dispose(); selected.dispose()
})

test('native dragstart releases placement deferral and later drag previews continue immediately', async () => {
  const page = attachNativePage(document.createElement('div'), 'tab', false, null)
  await flushMicrotasks()
  pressHeader()
  removePassthrough = installWorkspaceNativePassthrough()
  page.bounds(null, true)
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(0)
  tabDragSession.beginTab({ courseId: 'source', panelId: 'panel', nonce: 'drag' })
  expect(mocks.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: true })
  expect(boundsCalls()).toHaveLength(0)
  await flushMicrotasks()
  expect(boundsCalls()).toEqual([['browser:pageBounds', { tabId: 'tab', bounds: null, preview: true }]])
  window.dispatchEvent(new MouseEvent('pointercancel'))
  page.bounds({ x: 10, y: 20, width: 300, height: 400 }, true)
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(2)
  expect(tabDragSession.getSnapshot()).toBe('tab')
  page.dispose()
})

test('page creation resolving during a header press cannot apply queued placement until the press ends', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const page = attachNativePage(document.createElement('div'), 'tab', false, null)
  page.bounds({ x: 0, y: 0, width: 300, height: 400 })
  pressHeader()
  resolve({ state: { id: 41 }, adopted: false })
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(0)
  window.dispatchEvent(new MouseEvent('pointerup'))
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(1)
  tabDragSession.end()
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(1)
  page.dispose()
})

test('disposing a page discards placement deferred by a header press', async () => {
  const page = attachNativePage(document.createElement('div'), 'tab', false, null)
  await flushMicrotasks()
  pressHeader()
  page.bounds(null)
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(0)
  page.dispose()
  window.dispatchEvent(new MouseEvent('pointerup'))
  await flushMicrotasks()
  expect(boundsCalls()).toHaveLength(0)
})
