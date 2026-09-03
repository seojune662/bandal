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
    expect(html).toContain(`>전체</span><span>${SHORTCUT_SPECS.length}</span>`)
    expect(html).toContain('>변경됨</span><span>2</span>')
    expect(html).toContain('>미할당</span><span>2</span>')
    expect(html).toContain('>전역</h3>')
    expect(html).toContain('>화이트보드</h3>')
    expect(html).toContain('>고정</span>')
  })
})
