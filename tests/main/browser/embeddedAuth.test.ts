import { EventEmitter } from 'node:events'
import { JSDOM } from 'jsdom'
import { expect, test, vi } from 'vitest'
import { attachEmbeddedAuthFallback, EMBEDDED_AUTH_BLOCKED, EMBEDDED_AUTH_OBSERVER, inheritEmbeddedAuthSource } from '../../../src/main/features/browser/embeddedAuth'

class Page extends EventEmitter {
  url = 'https://chatgpt.com/'
  getURL = () => this.url
  isDestroyed = () => false
  executeJavaScript = vi.fn(async () => undefined)
  navigate(url: string) { this.emit('will-navigate'); this.url = url; this.emit('did-navigate', {}, url); this.emit('dom-ready') }
  blocked() { this.emit('console-message', {}, 0, EMBEDDED_AUTH_BLOCKED) }
  get electron() { return this as unknown as Electron.WebContents }
}

test('a main tab reports delayed Google refusal once and restarts the initiating service', () => {
  const page = new Page(), blocked = vi.fn()
  attachEmbeddedAuthFallback(page.electron, blocked)
  page.navigate('https://auth.openai.com/authorize?state=old')
  expect(page.executeJavaScript).not.toHaveBeenCalled()
  page.navigate('https://accounts.google.com/signin?state=old')
  expect(page.executeJavaScript).toHaveBeenCalledWith(EMBEDDED_AUTH_OBSERVER)
  page.blocked(); page.blocked()
  expect(blocked).toHaveBeenCalledExactlyOnceWith('https://chatgpt.com/')
  page.navigate('https://accounts.google.com/signin?state=new'); page.blocked()
  expect(blocked).toHaveBeenCalledTimes(2)
})

test('a nested login tab inherits its opener service across authentication redirects', () => {
  const parent = new Page(), child = new Page(), blocked = vi.fn()
  attachEmbeddedAuthFallback(parent.electron, vi.fn())
  parent.navigate('https://accounts.google.com/signin')
  child.url = 'about:blank'
  inheritEmbeddedAuthSource(child.electron, parent.electron)
  attachEmbeddedAuthFallback(child.electron, blocked)
  child.navigate('https://accounts.google.com/signin?state=child'); child.blocked()
  expect(blocked).toHaveBeenCalledExactlyOnceWith('https://chatgpt.com/')
})

test('ordinary pages cannot spoof a Google refusal through a console message', () => {
  const page = new Page(), blocked = vi.fn()
  attachEmbeddedAuthFallback(page.electron, blocked)
  page.navigate('https://accounts.google.com.attacker.test/'); page.blocked()
  expect(blocked).not.toHaveBeenCalled()
  expect(page.executeJavaScript).not.toHaveBeenCalled()
})

test('observer notices a refusal rendered after load, and ignores a generic credential error', async () => {
  const dom = new JSDOM('<body><main>Couldn\'t sign you in. Check your password.</main></body>', { runScripts: 'outside-only' })
  const report = vi.fn()
  dom.window.console.debug = report
  try {
    dom.window.eval(EMBEDDED_AUTH_OBSERVER)
    expect(report).not.toHaveBeenCalled()
    dom.window.document.querySelector('main')!.textContent = '브라우저 또는 앱이 안전하지 않을 수 있습니다.'
    await vi.waitFor(() => expect(report).toHaveBeenCalledExactlyOnceWith(EMBEDDED_AUTH_BLOCKED))
    // Another installation for the same document must not duplicate observers.
    dom.window.eval(EMBEDDED_AUTH_OBSERVER)
    expect(report).toHaveBeenCalledOnce()
  } finally { dom.window.close() }
})
