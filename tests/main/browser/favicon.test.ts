import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createFaviconFetcher,
  resetFaviconCacheForTests
} from '../../../src/main/features/browser/favicon'

function response(
  body: Uint8Array,
  contentType: string,
  ok = true
): Response {
  return {
    ok,
    headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body.buffer
  } as unknown as Response
}

const PNG = new Uint8Array([137, 80, 78, 71])

describe('favicon fetcher', () => {
  beforeEach(() => resetFaviconCacheForTests())

  test('returns a data URL so the renderer CSP stays untouched', async () => {
    const fetcher = createFaviconFetcher({
      fetch: async () => response(PNG, 'image/png')
    })
    const result = await fetcher('https://myetl.snu.ac.kr/favicon.ico')
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  test('refuses SVG — a data-URL SVG can carry script', async () => {
    const fetcher = createFaviconFetcher({
      fetch: async () =>
        response(new TextEncoder().encode('<svg/>'), 'image/svg+xml')
    })
    expect(await fetcher('https://a.ac.kr/icon.svg')).toBeNull()
  })

  test('refuses anything that is not a raster image', async () => {
    for (const type of ['text/html', 'application/json', '']) {
      resetFaviconCacheForTests()
      const fetcher = createFaviconFetcher({
        fetch: async () => response(PNG, type)
      })
      expect(await fetcher('https://a.ac.kr/x'), type).toBeNull()
    }
  })

  test('honours the content-type parameters', async () => {
    const fetcher = createFaviconFetcher({
      fetch: async () => response(PNG, 'image/png; charset=binary')
    })
    expect(await fetcher('https://a.ac.kr/x')).toMatch(/^data:image\/png/)
  })

  test('refuses an oversized response', async () => {
    const fetcher = createFaviconFetcher({
      fetch: async () => response(new Uint8Array(200 * 1024), 'image/png')
    })
    expect(await fetcher('https://a.ac.kr/big.png')).toBeNull()
  })

  test('refuses an empty body', async () => {
    const fetcher = createFaviconFetcher({
      fetch: async () => response(new Uint8Array(0), 'image/png')
    })
    expect(await fetcher('https://a.ac.kr/empty.png')).toBeNull()
  })

  test('a failed response is null, not an error', async () => {
    const fetcher = createFaviconFetcher({
      fetch: async () => response(PNG, 'image/png', false)
    })
    expect(await fetcher('https://a.ac.kr/404')).toBeNull()
  })

  test('a thrown fetch is null, not an error', async () => {
    const fetcher = createFaviconFetcher({
      fetch: async () => {
        throw new Error('offline')
      }
    })
    expect(await fetcher('https://a.ac.kr/x')).toBeNull()
  })

  test('never touches a non-http scheme', async () => {
    const fetch = vi.fn()
    const fetcher = createFaviconFetcher({ fetch })
    expect(await fetcher('file:///etc/passwd')).toBeNull()
    expect(await fetcher('nonsense')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('caches, including a negative result', async () => {
    const fetch = vi.fn(async () => response(PNG, 'text/html'))
    const fetcher = createFaviconFetcher({ fetch })
    await fetcher('https://a.ac.kr/x')
    await fetcher('https://a.ac.kr/x')
    // A school portal that serves no icon must not be re-fetched per tab.
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
