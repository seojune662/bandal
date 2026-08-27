import { describe, expect, test } from 'vitest'
import {
  chordFromKeyboardEvent,
  findConflicts,
  formatChord,
  matchChord,
  parseChord,
  printChord,
  resolveKeymap,
  SHORTCUT_SPECS
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

  test('keeps invalid and fixed overrides from corrupting defaults', () => {
    const keymap = resolveKeymap({
      'new-tab': 'mod+not-a-key',
      'whiteboard-pen': 'mod+shift+x'
    })

    expect(keymap.get('mod+t')).toBe('new-tab')
    expect(keymap.get('p')).toBe('whiteboard-pen')
    expect(keymap.get('mod+shift+x')).toBeUndefined()
    expect(parseChord('mod+mod+t')).toBeNull()
    expect(parseChord('mod++t')).toBeNull()
  })

  test('default shortcut contract snapshot', () => {
    expect(
      SHORTCUT_SPECS.map(({ id, defaultChord, guestAllowed }) => [
        id,
        defaultChord,
        guestAllowed
      ])
    ).toEqual([
        ["new-tab", "mod+t", true],
        ["new-markdown", "mod+shift+m", true],
        ["new-browser-tab", "mod+shift+b", true],
        ["close-tab", "mod+w", true],
        ["quick-search", "mod+p", false],
        ["settings", "mod+,", false],
        ["activate-tab-1", "mod+1", true],
        ["activate-tab-2", "mod+2", true],
        ["activate-tab-3", "mod+3", true],
        ["activate-tab-4", "mod+4", true],
        ["activate-tab-5", "mod+5", true],
        ["activate-tab-6", "mod+6", true],
        ["activate-tab-7", "mod+7", true],
        ["activate-tab-8", "mod+8", true],
        ["activate-last-tab", "mod+9", true],
        ["browser-back", "mod+[", true],
        ["browser-forward", "mod+]", true],
        ["browser-reload", "mod+r", true],
        ["browser-reload-hard", "mod+shift+r", true],
        ["browser-focus-address", "mod+l", true],
        ["browser-find", "mod+f", true],
        ["browser-bookmark", "mod+d", true],
        ["reopen-tab", "mod+shift+t", true],
        ["cycle-tab-prev", "mod+shift+[", true],
        ["cycle-tab-next", "mod+shift+]", true],
        ["browser-zoom-in", "mod+=", true],
        ["browser-zoom-out", "mod+-", true],
        ["browser-zoom-reset", "mod+0", true],
        ["toggle-left-rail", "mod+b", false],
        ["toggle-right-rail", "mod+alt+b", false],
        ["toggle-board", "mod+shift+d", false],
        ["add-course", "mod+shift+n", false],
        ["import-materials", "mod+shift+i", false],
        ["open-pip", "mod+shift+p", false],
        ["shortcut-help", "mod+/", false],
        ["send-feedback", null, false],
        ["whiteboard-select", "v", false],
        ["whiteboard-pen", "p", false],
        ["whiteboard-highlighter", "h", false],
        ["whiteboard-eraser", "e", false],
        ["whiteboard-text", "t", false],
        ["whiteboard-rectangle", "r", false],
        ["whiteboard-ellipse", "o", false],
    ])
  })
})
