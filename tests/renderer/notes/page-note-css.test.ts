import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const css = readFileSync(
  new URL(
    '../../../src/renderer/src/features/notes/note-tab.css',
    import.meta.url
  ),
  'utf8'
)

describe('PDF page-note paper layout', () => {
  test('keeps pages tightly stacked with compact outer padding', () => {
    expect(css).toMatch(
      /\.page-note-list\s*\{[^}]*gap:\s*2px;[^}]*padding:\s*var\(--space-1\) var\(--space-2\) var\(--space-4\);/s
    )
  })

  test('uses compact editor typography and leaves empty paper blank', () => {
    expect(css).toMatch(
      /\.note-tab \.page-note-paper \.milkdown \.editor\s*\{[^}]*padding:\s*var\(--space-5\) var\(--space-4\);[^}]*font-size:\s*calc\(var\(--text-sm\) \* var\(--note-font-scale\)\);/s
    )
    expect(css).toMatch(
      /\.note-tab \.page-note-paper \.milkdown \.note-editor-placeholder::before\s*\{[^}]*content:\s*none;/s
    )
  })
})
