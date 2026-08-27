import { describe, expect, test } from 'vitest'
import {
  chordFromKeyboardEvent,
  findConflicts,
  formatChord,
  matchChord,
  parseChord,
  printChord,
  resolveKeymap
} from '../../src/shared/keymap'

const event = (overrides: Partial<Parameters<typeof chordFromKeyboardEvent>[0]> = {}) => ({
  key: 'b',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides
})

describe('shared keymap contract', () => {
  test('parses, records, formats and matches canonical chords', () => {
    const chord = parseChord('shift+MOD+b')
    expect(chord).toEqual({ mod: true, alt: false, shift: true, key: 'b' })
    expect(formatChord(chord!, 'darwin')).toBe('⌘⇧B')
    expect(formatChord(chord!, 'win32')).toBe('Ctrl+Shift+B')
    expect(
      chordFromKeyboardEvent(event({ metaKey: true, shiftKey: true }))
    ).toBe('mod+shift+b')
    expect(matchChord(event({ ctrlKey: true, shiftKey: true }), 'mod+shift+b'))
      .toBe(true)
    expect(chordFromKeyboardEvent(event({ key: 'Meta', metaKey: true })))
      .toBeNull()
    expect(parseChord('mod+not-a-key')).toBeNull()
  })

  test('later overrides win and displace default bindings', () => {
    const keymap = resolveKeymap({
      'toggle-left-rail': 'mod+t',
      'send-feedback': 'mod+t'
    })
    expect(keymap.get('mod+t')).toBe('send-feedback')
    expect([...keymap.values()]).not.toContain('new-tab')
    expect([...keymap.values()]).not.toContain('toggle-left-rail')
    expect(findConflicts({ 'send-feedback': 'mod+t' }).get('mod+t'))
      .toEqual(['new-tab', 'send-feedback'])
  })

  test('null unbinds and print follows the quick-search chord', () => {
    expect(printChord(resolveKeymap({}))).toBe('mod+p')
    expect(printChord(resolveKeymap({ 'quick-search': 'mod+alt+p' })))
      .toBe('mod+alt+p')
    expect(printChord(resolveKeymap({ 'quick-search': null }))).toBeNull()
  })
})
