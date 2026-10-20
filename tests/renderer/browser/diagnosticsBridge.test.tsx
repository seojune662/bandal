// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  clearDiagnostics,
  diagnosticsFor,
  diagnosticsReport,
  useBrowserDiagnosticsBridge
} from '../../../src/renderer/src/features/browser/diagnosticsBridge'
import type { BrowserPageHandle } from '../../../src/renderer/src/features/browser/browserPageTypes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tabId = 'diagnostic-test'
const prefix = '__bandal_diag__'
const pageUrl = 'https://user:password@example.com/study?token=private#secret'
let root: Root
let host: HTMLDivElement
let page: BrowserPageHandle
let reporterSource: string

beforeEach(() => {
  vi.useFakeTimers()
  reporterSource = ''
  page = Object.assign(new EventTarget(), {
    executeJavaScript: vi.fn(async (source: string) => { reporterSource = source })
  }) as unknown as BrowserPageHandle
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const ref = { current: page }
  function Harness(): null {
    useBrowserDiagnosticsBridge(tabId, ref)
    return null
  }
  act(() => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  clearDiagnostics(tabId)
  vi.useRealTimers()
})

function consoleMessage(message: string): void {
  page.dispatchEvent(Object.assign(new Event('console-message'), { message }))
}

function reportEnvironment(value: unknown): void {
  consoleMessage(prefix + JSON.stringify({ kind: 'env', message: JSON.stringify(value), url: pageUrl }))
}

function environment(): Record<string, boolean | number> {
  const entry = diagnosticsFor(tabId)?.entries.filter(candidate => candidate.kind === 'env').at(-1)
  return JSON.parse(entry?.message ?? '{}')
}

function guestFixture() {
  const queries = new Map([
    ['(hover: hover)', Object.assign(new EventTarget(), { matches: true })],
    ['(any-hover: hover)', Object.assign(new EventTarget(), { matches: true })],
    ['(pointer: fine)', Object.assign(new EventTarget(), { matches: true })],
    ['(any-pointer: fine)', Object.assign(new EventTarget(), { matches: true })]
  ])
  const guest = Object.assign(new EventTarget(), {
    open: vi.fn(() => ({})),
    innerWidth: 960,
    innerHeight: 720,
    devicePixelRatio: 2,
    matchMedia: vi.fn((query: string) => queries.get(query)),
    setTimeout,
    clearTimeout
  })
  const navigator = { pdfViewerEnabled: true, cookieEnabled: true, maxTouchPoints: 0 }
  const log = vi.fn(consoleMessage)
  const context = { window: guest, navigator, location: new URL(pageUrl), console: { log } }
  const install = (): void => { runInNewContext(reporterSource, context) }
  return { guest, navigator, queries, log, install }
}

describe('browser environment diagnostics', () => {
  test('reports the initial viewport and hover capabilities without page data', () => {
    const { install, log } = guestFixture()
    install()
    expect(log).toHaveBeenCalledOnce()
    expect(environment()).toEqual({
      pdfViewerEnabled: true, cookieEnabled: true,
      viewportWidth: 960, viewportHeight: 720, devicePixelRatio: 2,
      hover: true, anyHover: true, pointerFine: true, anyPointerFine: true,
      maxTouchPoints: 0
    })
    expect(diagnosticsFor(tabId)?.url).toBe('https://example.com/study')
    expect(diagnosticsReport(tabId)).not.toMatch(/password|token|private|secret/)
  })

  test('debounces viewport and media changes, omits unchanged snapshots, and installs once', () => {
    const { guest, navigator, queries, log, install } = guestFixture()
    install()
    install()
    expect(log).toHaveBeenCalledOnce()
    guest.innerWidth = 700
    guest.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(200)
    guest.innerWidth = 680
    guest.innerHeight = 500
    guest.devicePixelRatio = 1.5
    navigator.maxTouchPoints = 2
    const hover = queries.get('(hover: hover)')!
    hover.matches = false
    hover.dispatchEvent(new Event('change'))
    const pointer = queries.get('(pointer: fine)')!
    pointer.matches = false
    pointer.dispatchEvent(new Event('change'))
    vi.advanceTimersByTime(249)
    expect(log).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    expect(log).toHaveBeenCalledTimes(2)
    expect(environment()).toMatchObject({
      viewportWidth: 680, viewportHeight: 500, devicePixelRatio: 1.5,
      hover: false, anyHover: true, pointerFine: false, anyPointerFine: true,
      maxTouchPoints: 2
    })
    guest.dispatchEvent(new Event('resize'))
    guest.dispatchEvent(new Event('mousemove'))
    guest.dispatchEvent(new Event('pointermove'))
    vi.advanceTimersByTime(250)
    expect(log).toHaveBeenCalledTimes(2)
  })

  test('allowlists typed environment fields and strips forged credentials', () => {
    reportEnvironment({
      pdfViewerEnabled: true, cookieEnabled: false,
      viewportWidth: 0, viewportHeight: 1_000, devicePixelRatio: 1.25,
      maxTouchPoints: 10, hover: false, anyHover: true, pointerFine: true, anyPointerFine: false,
      cookie: 'secret-cookie', username: 'private-user', password: 'secret-password',
      plugins: ['private-plugin'], contentType: 'private-content'
    })
    expect(environment()).toEqual({
      pdfViewerEnabled: true, cookieEnabled: false,
      viewportWidth: 0, viewportHeight: 1_000, devicePixelRatio: 1.25,
      maxTouchPoints: 10, hover: false, anyHover: true, pointerFine: true, anyPointerFine: false
    })
    expect(diagnosticsReport(tabId)).not.toMatch(/secret|private/)
  })

  test.each([
    { viewportWidth: -1, viewportHeight: 100_001, devicePixelRatio: 0, maxTouchPoints: 101 },
    { viewportWidth: 0.5, viewportHeight: '720', devicePixelRatio: 101, maxTouchPoints: 1.5 },
    { viewportWidth: null, viewportHeight: {}, devicePixelRatio: '2', maxTouchPoints: -1 },
    { pdfViewerEnabled: 'secret', cookieEnabled: 1, hover: 'true', anyHover: [], pointerFine: {}, anyPointerFine: null }
  ])('rejects wrong types and out-of-range environment fields: %j', value => {
    reportEnvironment(value)
    expect(environment()).toEqual({})
  })

  test('rejects non-finite numbers even when forged JSON parses successfully', () => {
    consoleMessage(prefix + JSON.stringify({
      kind: 'env', url: pageUrl,
      message: '{"viewportWidth":1e309,"viewportHeight":-1e309,"devicePixelRatio":1e309,"maxTouchPoints":1e309}'
    }))
    expect(environment()).toEqual({})
  })

  test.each([null, [], 'secret', 123])('ignores a malformed environment payload: %j', value => {
    reportEnvironment(value)
    expect(diagnosticsFor(tabId)).toBeNull()
  })

  test('clears the old document on navigation and reports a fresh document', () => {
    guestFixture().install()
    expect(diagnosticsFor(tabId)?.entries).toHaveLength(1)
    page.dispatchEvent(new Event('did-start-loading'))
    expect(diagnosticsFor(tabId)).toBeNull()
    page.dispatchEvent(new Event('dom-ready'))
    const next = guestFixture()
    next.guest.innerWidth = 500
    next.install()
    expect(diagnosticsFor(tabId)?.entries).toHaveLength(1)
    expect(environment().viewportWidth).toBe(500)
  })
})
