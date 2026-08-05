/**
 * The Milkdown plugin set every note editor loads, in order.
 *
 * Kept out of NoteTab.tsx so the composition is assertable without mounting an
 * editor — notably that `history` is present, since without it ⌘Z on the note
 * surface does nothing at all (backlog §4.1).
 */

import type { MilkdownPlugin } from '@milkdown/ctx'
import { history } from '@milkdown/plugin-history'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'

export const NOTE_EDITOR_PLUGINS: readonly MilkdownPlugin[][] = [
  commonmark,
  gfm,
  // undo/redo — also supplies the Mod-z / Shift-Mod-z / Mod-y keymap.
  history
]
