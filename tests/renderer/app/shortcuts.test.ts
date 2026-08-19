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

  test('⌘1..⌘8 activate the nth tab (0-based index)', () => {
    expect(resolveShortcut(input({ key: '1', metaKey: true }))).toEqual({
      type: 'activate-tab',
      index: 0
    })
    expect(resolveShortcut(input({ key: '8', metaKey: true }))).toEqual({
      type: 'activate-tab',
      index: 7
    })
  })

  test('⌘9 is the LAST tab, as in every browser', () => {
    expect(resolveShortcut(input({ key: '9', metaKey: true }))).toEqual({
      type: 'activate-last-tab'
    })
  })

  test('browser chrome chords resolve', () => {
    expect(resolveShortcut(input({ key: 'r', metaKey: true }))).toEqual({
      type: 'browser-reload',
      ignoreCache: false
    })
    expect(
      resolveShortcut(input({ key: 'r', metaKey: true, shiftKey: true }))
    ).toEqual({ type: 'browser-reload', ignoreCache: true })
    expect(resolveShortcut(input({ key: 'l', metaKey: true }))).toEqual({
      type: 'browser-focus-address'
    })
    expect(resolveShortcut(input({ key: 'f', metaKey: true }))).toEqual({
      type: 'browser-find'
    })
    expect(resolveShortcut(input({ key: 'd', metaKey: true }))).toEqual({
      type: 'browser-bookmark'
    })
  })

  test('⌘+ / ⌘- / ⌘0 drive zoom', () => {
    expect(resolveShortcut(input({ key: '=', metaKey: true }))).toEqual({
      type: 'browser-zoom',
      direction: 'in'
    })
    expect(resolveShortcut(input({ key: '-', metaKey: true }))).toEqual({
      type: 'browser-zoom',
      direction: 'out'
    })
    expect(resolveShortcut(input({ key: '0', metaKey: true }))).toEqual({
      type: 'browser-zoom',
      direction: 'reset'
    })
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

  test('alt always disqualifies the chord', () => {
    expect(
      resolveShortcut(input({ key: 'w', metaKey: true, altKey: true }))
    ).toBeNull()
    expect(
      resolveShortcut(input({ key: 't', metaKey: true, altKey: true }))
    ).toBeNull()
  })

  test('⇧ selects a different action rather than being ignored', () => {
    // ⌘T opens the new-tab menu; ⌘⇧T reopens the last closed tab.
    expect(
      resolveShortcut(input({ key: 't', metaKey: true, shiftKey: true }))
    ).toEqual({ type: 'reopen-tab' })
    expect(resolveShortcut(input({ key: 't', metaKey: true }))).toEqual({
      type: 'new-tab'
    })
  })

  test('⌘⇧[ and ⌘⇧] cycle tabs', () => {
    expect(
      resolveShortcut(input({ key: '[', metaKey: true, shiftKey: true }))
    ).toEqual({ type: 'cycle-tab', delta: -1 })
    expect(
      resolveShortcut(input({ key: ']', metaKey: true, shiftKey: true }))
    ).toEqual({ type: 'cycle-tab', delta: 1 })
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
