/**
 * Tab / Shift-Tab fallback for the note editor.
 *
 * Milkdown only binds Tab inside list items (sink) and tables (next cell).
 * Everywhere else the key fell through to the browser, which moved focus out
 * of the editor instead of indenting — users reported "Tab does nothing" while
 * writing .md notes. This keymap runs at the lowest priority, so the list and
 * table bindings still win, and it always consumes the key so focus never
 * escapes the note surface.
 */

import type { Command, EditorState } from '@milkdown/prose/state'
import { $useKeymap } from '@milkdown/utils'

const TAB_CHARACTER = '\t'

function isInListItem(state: EditorState): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'list_item') return true
  }
  return false
}

/** Inserts a literal tab, replacing any selection. */
export const insertTab: Command = (state, dispatch) => {
  // A list item Tab that could not sink (first item) must not turn into a
  // stray tab character inside the bullet text.
  if (isInListItem(state)) return true
  dispatch?.(state.tr.insertText(TAB_CHARACTER).scrollIntoView())
  return true
}

/** Removes a tab directly before the cursor, if there is one. */
export const removeTab: Command = (state, dispatch) => {
  const { $from, empty, from } = state.selection
  if (
    empty &&
    $from.parent.isTextblock &&
    $from.parentOffset > 0 &&
    $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset) ===
      TAB_CHARACTER
  ) {
    dispatch?.(state.tr.delete(from - 1, from).scrollIntoView())
  }
  return true
}

export const noteTabKeymap = $useKeymap('noteTab', {
  InsertTab: {
    shortcuts: 'Tab',
    priority: 0,
    command: () => insertTab
  },
  RemoveTab: {
    shortcuts: 'Shift-Tab',
    priority: 0,
    command: () => removeTab
  }
})
