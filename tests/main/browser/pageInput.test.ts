import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, test, vi } from 'vitest'
import { attachBrowserPageInputPolicy } from '../../../src/main/features/browser/pageInput'

class Page extends EventEmitter {
  destroyed = false
  isDestroyed = () => this.destroyed
  insertCSS = vi.fn(async (_source: string, _options: { cssOrigin: string }) => 'stylesheet')
}

function attach(page: Page): void {
  attachBrowserPageInputPolicy(page as unknown as WebContents)
}

describe('browser page input policy', () => {
  test('protects an adopted document immediately without waiting for another navigation', () => {
    const page = new Page()
    attach(page)
    expect(page.insertCSS).toHaveBeenCalledOnce()
    const [source, options] = page.insertCSS.mock.calls[0]!
    expect(options).toEqual({ cssOrigin: 'user' })
    // The native Electron probe verifies the effective CSS value and hit test.
    // This contract only checks user-origin policy and pseudo-element coverage.
    expect(source).toContain('*::before')
    expect(source).toContain('*::after')
    expect(source).toMatch(/-webkit-app-region:\s*initial\s*!important/)
    expect(source).toMatch(/(?:^|\n)\s*app-region:\s*initial\s*!important/)
  })

  test('reapplies to replacement documents without depending on load completion', () => {
    const page = new Page()
    attach(page)
    page.emit('dom-ready')
    page.emit('did-stop-loading')
    page.emit('did-navigate-in-page')
    page.emit('dom-ready')
    expect(page.insertCSS).toHaveBeenCalledTimes(3)
    for (const call of page.insertCSS.mock.calls) expect(call).toEqual(page.insertCSS.mock.calls[0])
  })

  test('an old document insertion rejecting cannot suppress the replacement policy', async () => {
    const page = new Page()
    let rejectOld!: (error: Error) => void
    page.insertCSS.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { rejectOld = reject }))
    attach(page)
    page.emit('dom-ready')
    expect(page.insertCSS).toHaveBeenCalledTimes(2)
    rejectOld(new Error('Document replaced'))
    await Promise.resolve()
    page.emit('dom-ready')
    expect(page.insertCSS).toHaveBeenCalledTimes(3)
  })

  test('a rejected initial insertion still allows a later document to receive the policy', async () => {
    const page = new Page()
    page.insertCSS.mockRejectedValueOnce(new Error('Document not ready'))
    attach(page)
    await Promise.resolve()
    page.emit('dom-ready')
    expect(page.insertCSS).toHaveBeenCalledTimes(2)
  })

  test('does not insert into a page already destroyed when it is adopted', () => {
    const page = new Page()
    page.destroyed = true
    attach(page)
    page.emit('dom-ready')
    expect(page.insertCSS).not.toHaveBeenCalled()
  })

  test('handles an in-flight insertion rejected by closing the page', async () => {
    const page = new Page()
    let rejectClosed!: (error: Error) => void
    page.insertCSS.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { rejectClosed = reject }))
    attach(page)
    page.destroyed = true
    page.emit('destroyed')
    rejectClosed(new Error('WebContents destroyed'))
    await Promise.resolve()
    page.emit('dom-ready')
    expect(page.insertCSS).toHaveBeenCalledOnce()
  })
})
