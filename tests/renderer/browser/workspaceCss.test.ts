import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('workspace tab strip CSS', () => {
  test('hides both native scrollbar axes without clipping wheel scrolling', () => {
    const css = readFileSync(
      resolve('src/renderer/src/features/workspace/workspace.css'),
      'utf8'
    )

    expect(css).toContain('overflow-x: auto;')
    expect(css).toContain('overflow-y: hidden;')
    expect(css).toContain('scrollbar-width: none;')
    expect(css).toMatch(
      /\.dv-tabs-container\.dv-horizontal::\-webkit-scrollbar\s*\{[^}]*display:\s*none;/s
    )
    expect(css).toContain('box-shadow: inset 0 -1px 0 var(--border-subtle);')
    expect(css).not.toContain('border-bottom: 1px solid var(--border-subtle);')
  })
})
