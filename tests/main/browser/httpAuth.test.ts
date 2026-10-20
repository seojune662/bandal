/**
 * HTTP authentication prompts.
 *
 * There was no handler at all, and Electron's default with no `login`
 * listener is to CANCEL the request — so 도서관 학외접속 프록시 and older
 * 학사 시스템 rendered a blank rect with no prompt, and a student behind an
 * authenticating campus proxy had a browser that failed every request.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const native = vi.hoisted(() => ({
  windows: [] as any[],
  showMessageBox: vi.fn(async () => ({ response: 1 }))
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class BrowserWindow extends EventEmitter {
    static getFocusedWindow = () => ({})
    webContents = new EventEmitter()
    loadURL = vi.fn(async () => undefined)
    show = vi.fn()
    destroyed = false
    constructor() { super(); native.windows.push(this) }
    isDestroyed() { return this.destroyed }
    close() { this.destroyed = true; this.emit('closed') }
  }
  return { BrowserWindow, dialog: { showMessageBox: native.showMessageBox } }
})

import {
  askForCredentials,
  authPromptCopy,
  authPromptKey,
  resolveAuthPrompt
} from '../../../src/main/features/browser/httpAuth'

const SITE = {
  isProxy: false,
  host: 'lib.snu.ac.kr',
  port: 443,
  realm: 'Library',
  scheme: 'basic'
}

describe('authPromptCopy', () => {
  test('names the site and its realm', () => {
    const copy = authPromptCopy(SITE)
    expect(copy.message).toContain('lib.snu.ac.kr')
    expect(copy.detail).toContain('Library')
  })

  test('says PROXY when it is a proxy', () => {
    // The classic attack is a site that triggers a 407 so the box reads like a
    // system prompt. Saying which it is costs one line.
    const copy = authPromptCopy({ ...SITE, isProxy: true })
    expect(copy.message).toContain('프록시')
    expect(copy.detail).toContain('웹사이트가 아니라')
  })

  test('a realm-less challenge does not print an empty 영역', () => {
    const copy = authPromptCopy({ ...SITE, realm: '' })
    expect(copy.detail).not.toContain('영역:')
  })

  test('the port is shown only when it is part of the identity', () => {
    expect(authPromptCopy({ ...SITE, port: 8443 }).message).toContain(':8443')
    expect(authPromptCopy({ ...SITE, port: 0 }).message).not.toContain(':0')
  })
})

describe('native credential input', () => {
  beforeEach(() => {
    native.windows.length = 0
    native.showMessageBox.mockResolvedValue({ response: 1 })
  })

  async function submit(index: number, value: string): Promise<void> {
    await vi.waitFor(() => expect(native.windows).toHaveLength(index + 1))
    const window = native.windows[index]
    const html = decodeURIComponent(window.loadURL.mock.calls[0][0].split(',').slice(1).join(','))
    const source = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    const listeners: Record<string, Record<string, (...args: any[]) => void>> = {}
    const document = {
      getElementById: (id: string) => ({
        value,
        focus() {},
        addEventListener(name: string, listener: (...args: any[]) => void) {
          ;(listeners[id] ??= {})[name] = listener
        }
      })
    }
    const location = { href: '' }
    new Function('document', 'location', source)(document, location)
    listeners.o.click()
    const event = { preventDefault: vi.fn() }
    window.webContents.emit('will-navigate', event, location.href)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  }

  test.each(['cancel', '', '취소 /? #% + 입력'])('preserves the credential value %j', async value => {
    const result = askForCredentials(SITE)
    await submit(0, value)
    await submit(1, value)
    expect(await result).toEqual({ username: value, password: value })
  })

  test('closing a credential window still cancels authentication', async () => {
    const result = askForCredentials(SITE)
    await vi.waitFor(() => expect(native.windows).toHaveLength(1))
    native.windows[0].close()
    expect(await result).toBeNull()
  })
})

describe('authPromptKey', () => {
  test('proxy and site challenges are different questions', () => {
    expect(authPromptKey(SITE)).not.toBe(authPromptKey({ ...SITE, isProxy: true }))
  })

  test('realm is part of the identity', () => {
    expect(authPromptKey(SITE)).not.toBe(authPromptKey({ ...SITE, realm: 'Other' }))
  })
})

describe('resolveAuthPrompt', () => {
  test('returns what the student typed', async () => {
    const ask = vi.fn(async () => ({ username: 'a', password: 'b' }))
    expect(await resolveAuthPrompt(SITE, { ask })).toEqual({
      username: 'a',
      password: 'b'
    })
  })

  test('cancelling means the request fails, as in a browser', async () => {
    const ask = vi.fn(async () => null)
    expect(await resolveAuthPrompt(SITE, { ask })).toBeNull()
  })

  test('a failed dialog cancels the request and allows a later retry', async () => {
    const ask = vi.fn()
      .mockRejectedValueOnce(new Error('Owner window closed'))
      .mockResolvedValueOnce({ username: 'a', password: 'b' })
    expect(await resolveAuthPrompt(SITE, { ask })).toBeNull()
    expect(await resolveAuthPrompt(SITE, { ask })).toEqual({ username: 'a', password: 'b' })
  })

  test('a page cannot stack prompts by retrying in a loop', async () => {
    // A 401 loop would otherwise put an unbounded chain of modal boxes over
    // the whole app.
    let release: (value: null) => void = () => undefined
    const pending = new Promise<null>((resolve) => {
      release = resolve
    })
    const ask = vi.fn(() => pending)
    const first = resolveAuthPrompt(SITE, { ask })
    const second = await resolveAuthPrompt(SITE, { ask })
    expect(second).toBeNull()
    expect(ask).toHaveBeenCalledTimes(1)
    release(null)
    await first
  })

  test('a different challenge is still allowed while one is open', async () => {
    let release: (value: null) => void = () => undefined
    const pending = new Promise<null>((resolve) => {
      release = resolve
    })
    const ask = vi.fn(() => pending)
    const first = resolveAuthPrompt(SITE, { ask })
    void resolveAuthPrompt({ ...SITE, host: 'other.ac.kr' }, { ask })
    expect(ask).toHaveBeenCalledTimes(2)
    release(null)
    await first
  })
})
