import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const HTML_ENTRIES = ['index.html', 'settings.html', 'overlay.html', 'pip.html']

describe('renderer entry CSP', () => {
  test.each(HTML_ENTRIES)('%s keeps plugin pages out of the app renderer', (file) => {
    const html = readFileSync(join(process.cwd(), 'src/renderer', file), 'utf8')
    const csp = html.match(
      /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/i
    )?.[1]

    expect(csp).toBeDefined()
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('bandal-plugin:')
  })
})
