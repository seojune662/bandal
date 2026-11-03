import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { SHORTCUT_SPECS } from '../../../../src/shared/keymap'
import { DEFAULT_SETTINGS } from '../../../../src/shared/types/settings'
import { ShortcutsPanel } from '../../../../src/renderer/src/features/settings/shortcuts/ShortcutsPanel'

describe('ShortcutsPanel', () => {
  test('renders status counts, scope groups, and fixed rows', () => {
    const html = renderToStaticMarkup(
      <ShortcutsPanel
        settings={{
          ...DEFAULT_SETTINGS,
          keybindings: { 'new-tab': null, 'close-tab': 'mod+t' }
        }}
      />
    )

    expect(html).toContain('role="radiogroup"')
    const count = (label: string, value: number) =>
      new RegExp(`>${label}</span><span[^>]*>${value}</span>`)
    expect(html).toMatch(count('전체', SHORTCUT_SPECS.length))
    expect(html).toMatch(count('변경됨', 2))
    expect(html).toMatch(count('미할당', 2))
    expect(html).toMatch(/>전역<\/h3>/)
    expect(html).toMatch(/>노트<\/h3>/)
    expect(html).toMatch(/>고정<\/span>/)
    expect(html).toContain('aria-label="단축키 작업"')
  })
})
