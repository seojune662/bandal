import { describe, expect, test, vi } from 'vitest'
import { history } from '@milkdown/plugin-history'
import type { EditorView } from '@milkdown/prose/view'
import { NOTE_EDITOR_PLUGINS } from '../../../src/renderer/src/features/notes/noteEditorPlugins'
import {
  createHistoryBeforeInputHandler,
  nativeHistoryGuard
} from '../../../src/renderer/src/features/notes/nativeHistoryGuard'

/** Minimal stand-in: the handler only forwards state/dispatch to a command. */
function fakeView(): EditorView {
  return { state: {}, dispatch: vi.fn() } as unknown as EditorView
}

function beforeInput(inputType: string): InputEvent & { prevented: boolean } {
  const event = {
    inputType,
    prevented: false,
    preventDefault() {
      event.prevented = true
    }
  }
  return event as unknown as InputEvent & { prevented: boolean }
}

describe('note editor plugin set', () => {
  test('loads the history plugin so ⌘Z has something to undo', () => {
    // Without @milkdown/plugin-history the editor has no undo stack at all.
    expect(NOTE_EDITOR_PLUGINS).toContain(history)
  })

  test('history is a non-empty plugin bundle', () => {
    expect(history.length).toBeGreaterThan(0)
  })
})

describe('native history guard', () => {
  test('routes a native undo into ProseMirror instead of the DOM', () => {
    const undo = vi.fn().mockReturnValue(true)
    const redo = vi.fn().mockReturnValue(true)
    const handle = createHistoryBeforeInputHandler({ undo, redo })
    const event = beforeInput('historyUndo')

    expect(handle(fakeView(), event)).toBe(true)
    // Cancelling is the whole point: an uncancelled execCommand('undo') edits
    // the contenteditable behind ProseMirror's back.
    expect(event.prevented).toBe(true)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).not.toHaveBeenCalled()
  })

  test('routes a native redo into ProseMirror', () => {
    const undo = vi.fn().mockReturnValue(true)
    const redo = vi.fn().mockReturnValue(true)
    const handle = createHistoryBeforeInputHandler({ undo, redo })
    const event = beforeInput('historyRedo')

    expect(handle(fakeView(), event)).toBe(true)
    expect(event.prevented).toBe(true)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(undo).not.toHaveBeenCalled()
  })

  test('still cancels the native edit when there is nothing to undo', () => {
    const undo = vi.fn().mockReturnValue(false)
    const handle = createHistoryBeforeInputHandler({ undo, redo: vi.fn() })
    const event = beforeInput('historyUndo')

    expect(handle(fakeView(), event)).toBe(true)
    expect(event.prevented).toBe(true)
  })

  test.each(['insertText', 'deleteContentBackward', 'insertParagraph'])(
    'leaves ordinary %s input alone',
    (inputType) => {
      const undo = vi.fn()
      const redo = vi.fn()
      const handle = createHistoryBeforeInputHandler({ undo, redo })
      const event = beforeInput(inputType)

      expect(handle(fakeView(), event)).toBe(false)
      expect(event.prevented).toBe(false)
      expect(undo).not.toHaveBeenCalled()
      expect(redo).not.toHaveBeenCalled()
    }
  )

  test('exposes the guard as a ProseMirror beforeinput handler', () => {
    const undo = vi.fn().mockReturnValue(true)
    const plugin = nativeHistoryGuard({ undo, redo: vi.fn() })
    const handler = plugin.props.handleDOMEvents?.['beforeinput']
    expect(handler).toBeTypeOf('function')

    const event = beforeInput('historyUndo')
    expect(handler?.call(plugin, fakeView(), event as unknown as InputEvent)).toBe(
      true
    )
    expect(undo).toHaveBeenCalledTimes(1)
  })
})
