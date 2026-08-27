import { describe, expect, test } from 'vitest'
import {
  assignChord,
  conflictingAction,
  effectiveChords,
  restoreDefault
} from '../../../src/renderer/src/features/help/shortcutModel'

describe('shortcut help model', () => {
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
})
