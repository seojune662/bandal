import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import {
  createPluginProtocolHandler,
  parsePluginUrl
} from '../../../src/main/features/plugins/pluginProtocol'

const EXPECTED_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

describe('parsePluginUrl', () => {
  test('parses panel assets and the root stylesheet exception', () => {
    expect(
      parsePluginUrl('bandal-plugin://bandal.word-count/ui/index.html')
    ).toEqual({
      pluginId: 'bandal.word-count',
      segments: ['index.html'],
      isStyles: false
    })
    expect(
      parsePluginUrl('bandal-plugin://bandal.word-count/ui/js/panel.js')
    ).toEqual({
      pluginId: 'bandal.word-count',
      segments: ['js', 'panel.js'],
      isStyles: false
    })
    expect(
      parsePluginUrl('bandal-plugin://bandal.word-count/styles.css')
    ).toEqual({
      pluginId: 'bandal.word-count',
      segments: [],
      isStyles: true
    })
  })

  test.each([
    'https://bandal.word-count/ui/index.html',
    'bandal-plugin://bandal.word-count/main.js',
    'bandal-plugin://bandal.word-count/ui/',
    'bandal-plugin://bandal.word-count/ui/%2e%2e/secret.txt',
    'bandal-plugin://bandal.word-count/ui/a%2fb.js',
    'bandal-plugin://bandal.word-count/ui/a%5cb.js',
    'not a url'
  ])('rejects an unsafe or out-of-scope URL: %s', (url) => {
    expect(parsePluginUrl(url)).toBeNull()
  })
})

describe('createPluginProtocolHandler', () => {
  const root = mkdtempSync(join(tmpdir(), 'bandal-plugin-protocol-'))
  const pluginRoot = join(root, 'bandal.word-count')
  mkdirSync(join(pluginRoot, 'ui'), { recursive: true })
  writeFileSync(join(pluginRoot, 'ui', 'index.html'), '<h1>단어 수</h1>')
  writeFileSync(join(pluginRoot, 'ui', 'panel.js'), 'export const ready = true')
  writeFileSync(join(pluginRoot, 'ui', 'data.json'), '{"ok":true}')
  writeFileSync(join(pluginRoot, 'styles.css'), 'body { color: white; }')
  writeFileSync(join(root, 'secret.txt'), 'never serve this')

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const handler = createPluginProtocolHandler({
    rootFor: (pluginId) =>
      pluginId === 'bandal.word-count' ? pluginRoot : null,
    stylesFor: (pluginId) => pluginId === 'bandal.word-count'
  })

  test('serves a panel file with the fixed sandbox headers', async () => {
    const response = await handler(
      new Request('bandal-plugin://bandal.word-count/ui/index.html')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Content-Security-Policy')).toBe(EXPECTED_CSP)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toContain('<h1>단어 수</h1>')
  })

  test('maps JavaScript, JSON and CSS content types', async () => {
    const js = await handler(
      new Request('bandal-plugin://bandal.word-count/ui/panel.js')
    )
    const json = await handler(
      new Request('bandal-plugin://bandal.word-count/ui/data.json')
    )
    const css = await handler(
      new Request('bandal-plugin://bandal.word-count/styles.css')
    )

    expect(js.headers.get('Content-Type')).toContain('javascript')
    expect(json.headers.get('Content-Type')).toContain('application/json')
    expect(css.headers.get('Content-Type')).toContain('text/css')
    expect(css.status).toBe(200)
  })

  test('returns 404 for missing plugins, files and traversal attempts', async () => {
    const urls = [
      'bandal-plugin://missing.plugin/ui/index.html',
      'bandal-plugin://bandal.word-count/ui/missing.html',
      'bandal-plugin://bandal.word-count/ui/%2e%2e/%2e%2e/secret.txt'
    ]

    for (const url of urls) {
      expect((await handler(new Request(url))).status).toBe(404)
    }
  })

  test('serves styles.css only when the manifest opted in', async () => {
    const withoutStyles = createPluginProtocolHandler({
      rootFor: () => pluginRoot,
      stylesFor: () => false
    })

    const response = await withoutStyles(
      new Request('bandal-plugin://bandal.word-count/styles.css')
    )
    expect(response.status).toBe(404)
  })
})
