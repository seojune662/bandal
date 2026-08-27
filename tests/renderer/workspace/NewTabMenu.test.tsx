import { describe, expect, test } from 'vitest'
import { resolveKeymap } from '../../../src/shared/keymap'
import { shortcutLabel } from '../../../src/renderer/src/features/workspace/NewTabMenu'

describe('NewTabMenu shortcut labels', () => {
  test('formats the current resolved bindings for the host platform', () => {
    const keymap = resolveKeymap({
      'new-markdown': 'mod+alt+m',
      'new-browser-tab': 'mod+shift+n'
    })

    expect(shortcutLabel(keymap, 'new-markdown', 'darwin')).toBe('⌘⌥M')
    expect(shortcutLabel(keymap, 'new-browser-tab', 'win32')).toBe(
      'Ctrl+Shift+N'
    )
  })

  test('omits the label when an action is unbound', () => {
    const keymap = resolveKeymap({ 'new-markdown': null })

    expect(shortcutLabel(keymap, 'new-markdown', 'darwin')).toBeUndefined()
  })
})
