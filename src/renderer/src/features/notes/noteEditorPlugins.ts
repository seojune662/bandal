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
import { slashMenu } from './slashMenuPlugin'

export const NOTE_EDITOR_PLUGINS: readonly (MilkdownPlugin | MilkdownPlugin[])[] = [
  commonmark,
  gfm,
  // Direct ProseMirror plugin: placeholder and slash-triggered block menu.
  slashMenu,
  // undo/redo — also supplies the Mod-z / Shift-Mod-z / Mod-y keymap.
  history
]

let highlightedPluginsPromise:
  | Promise<readonly (MilkdownPlugin | MilkdownPlugin[])[]>
  | undefined
let prismPluginsPromise: Promise<MilkdownPlugin[]> | undefined

export function loadNotePrismPlugins(): Promise<MilkdownPlugin[]> {
  if (prismPluginsPromise === undefined) {
    prismPluginsPromise = import('@milkdown/plugin-prism').then(
      ({ prism }) =>
        // plugin-prism resolves Milkdown 7.22.1 while the app is on 7.22.0;
        // their runtime plugin contract is identical, but the private Ctx type
        // makes the two declarations nominally incompatible to TypeScript.
        prism as unknown as MilkdownPlugin[]
    )
  }
  return prismPluginsPromise
}

/** Prism is split from the initial notes bundle and loaded before editor creation. */
export function loadNoteEditorPlugins(): Promise<
  readonly (MilkdownPlugin | MilkdownPlugin[])[]
> {
  if (highlightedPluginsPromise === undefined) {
    highlightedPluginsPromise = loadNotePrismPlugins().then(
      (prismPlugins) => [...NOTE_EDITOR_PLUGINS, prismPlugins]
    )
  }
  return highlightedPluginsPromise
}
