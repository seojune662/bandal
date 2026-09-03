import { describe, expect, test } from 'vitest'
import {
  assignChord,
  conflictingAction,
  effectiveChords,
  formattedChordParts,
  importedKeybindings,
  restoreDefault
} from '../../../../src/renderer/src/features/settings/shortcuts/shortcutModel'

describe('shortcut settings model', () => {
  test('shows shared defaults and applies a custom chord', () => {
    expect(effectiveChords({}).get('shortcut-help')).toBe('mod+/')
    expect(
      effectiveChords({ 'shortcut-help': 'mod+shift+/' }).get('shortcut-help')
    ).toBe('mod+shift+/')
  })

  test('finds the action displaced by a recorded chord', () => {
    expect(conflictingAction({}, 'shortcut-help', 'mod+t')).toBe('new-tab')
    expect(conflictingAction({}, 'shortcut-help', 'mod+alt+/')).toBeNull()
  })

  test('confirming a collision explicitly unbinds the old owner', () => {
    const next = assignChord({}, 'shortcut-help', 'mod+t', 'new-tab')

    expect(next).toEqual({ 'new-tab': null, 'shortcut-help': 'mod+t' })
    expect(effectiveChords(next).get('shortcut-help')).toBe('mod+t')
    expect(effectiveChords(next).has('new-tab')).toBe(false)
  })

  test('default removes the action override while preserving displaced unbinding', () => {
    expect(
      restoreDefault(
        { 'shortcut-help': 'mod+alt+/', 'new-tab': 'mod+/' },
        'shortcut-help',
        'new-tab'
      )
    ).toEqual({ 'new-tab': null })
  })

  test('imports only known customizable actions with valid chord values', () => {
    expect(
      importedKeybindings({
        'new-tab': 'mod+shift+t',
        'close-tab': null,
        'whiteboard-pen': 'x',
        unknown: 'mod+k',
        settings: 'not-a-key',
        'quick-search': 42
      })
    ).toEqual({ 'new-tab': 'mod+shift+t', 'close-tab': null })
    expect(importedKeybindings([])).toBeNull()
  })

  test('keeps the plus key as its own keycap', () => {
    expect(formattedChordParts('mod+=', 'darwin')).toEqual(['⌘', '+'])
    expect(formattedChordParts('mod+=', 'win32')).toEqual(['Ctrl', '+'])
  })
})
