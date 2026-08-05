import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

import {
  resolveShortcut,
  type ShortcutInput
} from '../../../src/renderer/src/app/shortcuts'

function input(overrides: Partial<ShortcutInput>): ShortcutInput {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    targetIsWebview: false,
    ...overrides
  }
}

describe('resolveShortcut — chords', () => {
  test('⌘T opens the new-tab menu', () => {
    expect(resolveShortcut(input({ key: 't', metaKey: true }))).toEqual({
      type: 'new-tab'
    })
  })

  test('⌘W closes the active tab', () => {
    expect(resolveShortcut(input({ key: 'w', metaKey: true }))).toEqual({
      type: 'close-tab'
    })
  })

  test('⌘P opens quick file search', () => {
    expect(resolveShortcut(input({ key: 'p', metaKey: true }))).toEqual({
      type: 'quick-search'
    })
  })

  test('⌘, opens settings', () => {
    expect(resolveShortcut(input({ key: ',', metaKey: true }))).toEqual({
      type: 'settings'
    })
  })

  test('⌘1..⌘9 activate the nth tab (0-based index)', () => {
    expect(resolveShortcut(input({ key: '1', metaKey: true }))).toEqual({
      type: 'activate-tab',
      index: 0
    })
    expect(resolveShortcut(input({ key: '9', metaKey: true }))).toEqual({
      type: 'activate-tab',
      index: 8
    })
  })

  test('⌘0 is not a shortcut', () => {
    expect(resolveShortcut(input({ key: '0', metaKey: true }))).toBeNull()
  })

  test('ctrl works as the modifier too (non-mac parity)', () => {
    expect(resolveShortcut(input({ key: 't', ctrlKey: true }))).toEqual({
      type: 'new-tab'
    })
  })

  test('uppercase key (CapsLock) still matches', () => {
    expect(resolveShortcut(input({ key: 'W', metaKey: true }))).toEqual({
      type: 'close-tab'
    })
  })
})

describe('resolveShortcut — guards', () => {
  test('bare keys without a modifier never match', () => {
    expect(resolveShortcut(input({ key: 't' }))).toBeNull()
    expect(resolveShortcut(input({ key: 'w' }))).toBeNull()
  })

  test('alt or shift disqualifies the chord (⌘⇧T ≠ ⌘T)', () => {
    expect(
      resolveShortcut(input({ key: 't', metaKey: true, shiftKey: true }))
    ).toBeNull()
    expect(
      resolveShortcut(input({ key: 'w', metaKey: true, altKey: true }))
    ).toBeNull()
  })

  test('IME composition suppresses everything', () => {
    expect(
      resolveShortcut(input({ key: 't', metaKey: true, isComposing: true }))
    ).toBeNull()
    expect(
      resolveShortcut(input({ key: '1', metaKey: true, isComposing: true }))
    ).toBeNull()
  })

  test('webview focus allows only ⌘T/⌘W', () => {
    const inGuest = (key: string): ReturnType<typeof resolveShortcut> =>
      resolveShortcut(input({ key, metaKey: true, targetIsWebview: true }))
    expect(inGuest('t')).toEqual({ type: 'new-tab' })
    expect(inGuest('w')).toEqual({ type: 'close-tab' })
    expect(inGuest('p')).toBeNull()
    expect(inGuest(',')).toBeNull()
    expect(inGuest('1')).toBeNull()
  })

  test('unrelated keys resolve to nothing', () => {
    expect(resolveShortcut(input({ key: 'k', metaKey: true }))).toBeNull()
    expect(resolveShortcut(input({ key: 'Enter', metaKey: true }))).toBeNull()
  })
})
