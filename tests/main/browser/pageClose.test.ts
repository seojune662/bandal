import { EventEmitter } from 'node:events'
import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ ask: vi.fn(), owner: {} }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => mocks.owner },
  dialog: { showMessageBoxSync: mocks.ask }
}))
import { closePage, confirmPageUnload } from '../../../src/main/features/browser/pageClose'

class Page extends EventEmitter {
  dead = false
  dirty = true
  closeCalls = 0
  constructor() {
    super()
    this.on('will-prevent-unload', event => confirmPageUnload(this as never, event, {} as never))
  }
  isDestroyed() { return this.dead }
  close(options: { waitForBeforeUnload: boolean }) {
    this.closeCalls++
    expect(options.waitForBeforeUnload).toBe(true)
    let allowed = !this.dirty
    if (this.dirty) this.emit('will-prevent-unload', { preventDefault: () => { allowed = true } })
    if (allowed) { this.dead = true; this.emit('destroyed') }
  }
}
beforeEach(() => mocks.ask.mockReset())
test('a dirty profile switch asks exactly once and cancellation preserves the page', async () => {
  const page = new Page()
  mocks.ask.mockReturnValue(0)
  expect(await closePage(page as never, 'profile')).toBe(false)
  expect(page.dead).toBe(false)
  expect(mocks.ask).toHaveBeenCalledTimes(1)
  expect(page.listenerCount('destroyed')).toBe(0)
  mocks.ask.mockReturnValue(1)
  expect(await closePage(page as never, 'profile')).toBe(true)
  expect(page.dead).toBe(true)
  expect(mocks.ask).toHaveBeenCalledTimes(2)
})
test('tab close uses the same single beforeunload decision', async () => {
  const page = new Page()
  mocks.ask.mockReturnValue(1)
  expect(await closePage(page as never, 'tab')).toBe(true)
  expect(mocks.ask).toHaveBeenCalledTimes(1)
})
test('pages without unload protection and already closed pages need no prompt', async () => {
  const page = new Page()
  page.dirty = false
  expect(await closePage(page as never, 'tab')).toBe(true)
  expect(await closePage(page as never, 'tab')).toBe(true)
  expect(page.closeCalls).toBe(1)
  expect(mocks.ask).not.toHaveBeenCalled()
})
