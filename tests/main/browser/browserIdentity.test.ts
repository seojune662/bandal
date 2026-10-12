import { expect, test, vi } from 'vitest'
import { bandalBrowserUserAgent, configureBrowserIdentity } from '../../../src/main/features/browser/browserIdentity'

const product = { name: 'bandal', version: '0.79.9' }
const runtime = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) bandal/0.79.9 Chrome/150.0.7871.224 Electron/43.4.1 Safari/537.36'
const branded = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) bandal/0.79.9 Chrome/150.0.7871.224 Safari/537.36'

test('the browser identifies its actual app and engine without the embedded library product', () => {
  expect(bandalBrowserUserAgent(runtime, product)).toBe(branded)
  const windows = runtime.replace('Macintosh; Intel Mac OS X 10_15_7', 'Windows NT 10.0; Win64; x64').replace('150.0.7871.224', '151.0.1.2')
  expect(bandalBrowserUserAgent(windows, product)).toContain('Windows NT 10.0; Win64; x64')
  expect(bandalBrowserUserAgent(windows, product)).toContain('Chrome/151.0.1.2')
  expect(bandalBrowserUserAgent(windows, product)).toContain('bandal/0.79.9')
  expect(bandalBrowserUserAgent(branded, product)).toBe(branded)
})

test.each([undefined, 'product'] as const)('the ordinary app and product probe initialize the same global identity (%s)', identity => {
  const set = vi.fn()
  configureBrowserIdentity({ get userAgentFallback() { return runtime }, set userAgentFallback(value: string) { set(value) } }, product, identity)
  expect(set).toHaveBeenCalledExactlyOnceWith(branded)
})

test('the explicit native probe preserves the runtime as a comparison control', () => {
  const get = vi.fn(() => runtime), set = vi.fn()
  configureBrowserIdentity({ get userAgentFallback() { return get() }, set userAgentFallback(value: string) { set(value) } }, product, 'native')
  expect(get).not.toHaveBeenCalled()
  expect(set).not.toHaveBeenCalled()
})


test('a raw Electron development launch still identifies the actual Bandal build', () => {
  const rawElectron = runtime.replace(' bandal/0.79.9', '')
  const result = bandalBrowserUserAgent(rawElectron, product)
  expect(result).toContain('bandal/0.79.9')
  expect(result).toContain('Chrome/150.0.7871.224')
  expect(result).not.toMatch(/Electron\/|bandal\/43/)
  expect(result.split('bandal/')).toHaveLength(2)
  expect(bandalBrowserUserAgent(result, product)).toBe(result)
})

test('the supplied actual product version replaces a stale token without duplicating the brand', () => {
  const result = bandalBrowserUserAgent(runtime, { ...product, version: '1.2.3' })
  expect(result).toContain('bandal/1.2.3')
  expect(result).not.toContain('bandal/0.79.9')
  expect(result.split('bandal/')).toHaveLength(2)
})
