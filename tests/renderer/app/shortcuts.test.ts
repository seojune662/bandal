import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

import {
  ADD_COURSE_SHORTCUT_EVENT,
  FEEDBACK_EVENT,
  IMPORT_MATERIALS_SHORTCUT_EVENT,
  resolveShortcut,
  runShortcutAction,
  type ShortcutInput
} from '../../../src/renderer/src/app/shortcuts'
import { resolveKeymap } from '../../../src/shared/keymap'

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

  test('uses overrides instead of the hardcoded default chord', () => {
    const custom = resolveKeymap({ 'new-tab': 'mod+alt+k' })

    expect(
      resolveShortcut(input({ key: 't', metaKey: true }), custom)
    ).toBeNull()
    expect(
      resolveShortcut(
        input({ key: 'k', metaKey: true, altKey: true }),
        custom
      )
    ).toEqual({ type: 'new-tab' })
  })

  test('resolves the new app actions from the shared defaults', () => {
    expect(
      resolveShortcut(input({ key: 'b', metaKey: true }))
    ).toEqual({ type: 'toggle-left-rail' })
    expect(
      resolveShortcut(
        input({ key: 'b', metaKey: true, altKey: true })
      )
    ).toEqual({ type: 'toggle-right-rail' })
    expect(
      resolveShortcut(
        input({ key: '/', metaKey: true })
      )
    ).toEqual({ type: 'shortcut-help' })
    expect(
      resolveShortcut(
        input({ key: 'd', metaKey: true, shiftKey: true })
      )
    ).toEqual({ type: 'toggle-board' })
    expect(
      resolveShortcut(
        input({ key: 'n', metaKey: true, shiftKey: true })
      )
    ).toEqual({ type: 'add-course' })
    expect(
      resolveShortcut(
        input({ key: 'i', metaKey: true, shiftKey: true })
      )
    ).toEqual({ type: 'import-materials' })
    expect(
      resolveShortcut(
        input({ key: 'p', metaKey: true, shiftKey: true })
      )
    ).toEqual({ type: 'open-pip' })

    const withFeedback = resolveKeymap({ 'send-feedback': 'mod+alt+f' })
    expect(
      resolveShortcut(
        input({ key: 'f', metaKey: true, altKey: true }),
        withFeedback
      )
    ).toEqual({ type: 'send-feedback' })
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

  test('webview focus keeps tab lifetime and browser chrome, not app chrome', () => {
    const inGuest = (key: string): ReturnType<typeof resolveShortcut> =>
      resolveShortcut(input({ key, metaKey: true, targetIsWebview: true }))
    expect(inGuest('t')).toEqual({ type: 'new-tab' })
    expect(inGuest('w')).toEqual({ type: 'close-tab' })
    // Chrome switches tabs on ⌘1..8 wherever focus is; so do we now.
    expect(inGuest('1')).toEqual({ type: 'activate-tab', index: 0 })
    expect(inGuest('[')).toEqual({ type: 'browser-back' })
    // Genuinely app-only: ⌘P belongs to the 파일 menu, ⌘, to settings.
    expect(inGuest('p')).toBeNull()
    expect(inGuest(',')).toBeNull()
  })

  test('derives guest allowance from shortcut specs', () => {
    expect(
      resolveShortcut(
        input({
          key: 'm',
          metaKey: true,
          shiftKey: true,
          targetIsWebview: true
        })
      )
    ).toEqual({ type: 'new-markdown' })
    expect(
      resolveShortcut(
        input({
          key: 'b',
          metaKey: true,
          targetIsWebview: true
        })
      )
    ).toBeNull()
  })

  test('unrelated keys resolve to nothing', () => {
    expect(resolveShortcut(input({ key: 'k', metaKey: true }))).toBeNull()
    expect(resolveShortcut(input({ key: 'Enter', metaKey: true }))).toBeNull()
  })
})

describe('runShortcutAction — event entry points', () => {
  test.each([
    ['add-course', ADD_COURSE_SHORTCUT_EVENT],
    ['import-materials', IMPORT_MATERIALS_SHORTCUT_EVENT],
    ['send-feedback', FEEDBACK_EVENT]
  ] as const)('dispatches %s through %s', (type, eventName) => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal(
      'CustomEvent',
      class {
        readonly type: string

        constructor(name: string) {
          this.type = name
        }
      }
    )
    try {
      runShortcutAction({ type })
      expect(dispatchEvent).toHaveBeenCalledOnce()
      expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: eventName })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('runShortcutAction — shortcut-help', () => {
  test('opens the settings overlay on the shortcuts category', () => {
    const openSettings = vi.fn()
    const spy = vi
      .spyOn(useUiStore, 'getState')
      .mockReturnValue({ ...useUiStore.getState(), openSettings })
    try {
      runShortcutAction({ type: 'shortcut-help' })
      expect(openSettings).toHaveBeenCalledWith('shortcuts')
    } finally {
      spy.mockRestore()
    }
  })
})
