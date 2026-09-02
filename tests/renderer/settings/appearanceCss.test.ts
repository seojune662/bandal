/**
 * CSS half of the appearance knobs contract (src/shared/appearance.ts): the
 * tokens and selectors the runtime switches must exist in the stylesheets.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const STYLES = new URL('../../../src/renderer/src/styles/', import.meta.url)
const tokens = readFileSync(new URL('tokens.css', STYLES), 'utf8')
const base = readFileSync(new URL('base.css', STYLES), 'utf8')

describe('appearance knob tokens', () => {
  test('tokens.css seeds --font-scale and defines --font-serif', () => {
    expect(tokens).toMatch(/--font-scale:\s*1;/)
    expect(tokens).toMatch(/--font-serif:\s*[^;]*serif;/s)
  })

  test('base.css scales the root font-size by --font-scale exactly once', () => {
    expect(base).toMatch(/html\s*\{[^}]*font-size:\s*calc\(100% \* var\(--font-scale\)\)/s)
    expect(base.match(/var\(--font-scale\)/g)).toHaveLength(1)
  })

  test('base.css swaps the note editor family for serif and mono only', () => {
    expect(base).toMatch(
      /:root\[data-editor-font='serif'\] \.note-tab \.milkdown \.editor\s*\{[^}]*font-family: var\(--font-serif\)/s
    )
    expect(base).toMatch(
      /:root\[data-editor-font='mono'\] \.note-tab \.milkdown \.editor\s*\{[^}]*font-family: var\(--font-mono\)/s
    )
    expect(base).not.toMatch(/data-editor-font='sans'/)
  })

  test('tokens.css re-cuts only existing scale tokens for compact density', () => {
    const block = /:root\[data-density='compact'\]\s*\{([^}]*)\}/s.exec(tokens)?.[1]
    expect(block).toBeDefined()
    const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? ''
    for (const [, name] of block!.matchAll(/(--[\w-]+)\s*:/g)) {
      expect(rootBlock, `${name} is not a base token`).toContain(`${name}:`)
    }
    for (const name of ['--chrome-height', '--control-height', '--radius-md', '--space-3']) {
      expect(block).toContain(`${name}:`)
    }
  })
})
