import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const css = readFileSync(
  new URL('../../../src/renderer/src/features/settings/settings-app.css', import.meta.url),
  'utf8'
)

describe('settings Windows title-bar overlay', () => {
  test('keeps the embedded sidebar below the Windows chrome height', () => {
    expect(css).toMatch(
      /:root\[data-platform='win32'\] \.settings-app--embedded \.settings-sidebar\s*\{[^}]*padding-top: var\(--chrome-height\)/s
    )
  })

  test('marks the back button and search controls as non-draggable', () => {
    expect(css).toMatch(/\.back-button\s*\{[^}]*-webkit-app-region: no-drag/s)
    expect(css).toMatch(/\.settings-search\s*\{[^}]*-webkit-app-region: no-drag/s)
    expect(css).toMatch(/\.settings-search input\s*\{[^}]*-webkit-app-region: no-drag/s)
  })
})
