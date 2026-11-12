import { describe, expect, test } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { EditorState, TextSelection, type Transaction } from '@milkdown/prose/state'
import { NOTE_EDITOR_PLUGINS } from '../../../src/renderer/src/features/notes/noteEditorPlugins'
import {
  insertTab,
  noteTabKeymap,
  removeTab
} from '../../../src/renderer/src/features/notes/noteTabKeymap'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    text: {}
  }
})

function stateWith(doc: ReturnType<Schema['node']>, pos: number): EditorState {
  const state = EditorState.create({ schema, doc })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function run(
  command: typeof insertTab,
  state: EditorState
): { handled: boolean; next: EditorState } {
  let next = state
  const handled = command(state, (tr: Transaction) => {
    next = state.apply(tr)
  })
  return { handled, next }
}

const paragraph = (text: string) =>
  schema.node('doc', null, [schema.node('paragraph', null, text ? [schema.text(text)] : [])])

describe('note Tab keymap', () => {
  test('is registered in the note editor plugin set', () => {
    expect(NOTE_EDITOR_PLUGINS).toContain(noteTabKeymap)
  })

  test('Tab inserts a tab character in a paragraph and consumes the key', () => {
    const { handled, next } = run(insertTab, stateWith(paragraph('ab'), 2))
    expect(handled).toBe(true)
    expect(next.doc.textContent).toBe('a\tb')
  })

  test('Tab inside a list item never inserts a stray tab', () => {
    const list = schema.node('doc', null, [
      schema.node('bullet_list', null, [
        schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('x')])])
      ])
    ])
    const { handled, next } = run(insertTab, stateWith(list, 4))
    expect(handled).toBe(true)
    expect(next.doc.textContent).toBe('x')
  })

  test('Shift-Tab removes the tab before the cursor', () => {
    const { handled, next } = run(removeTab, stateWith(paragraph('\tab'), 2))
    expect(handled).toBe(true)
    expect(next.doc.textContent).toBe('ab')
  })

  test('Shift-Tab without a preceding tab is consumed but changes nothing', () => {
    const state = stateWith(paragraph('ab'), 2)
    const { handled, next } = run(removeTab, state)
    expect(handled).toBe(true)
    expect(next.doc.eq(state.doc)).toBe(true)
  })
})
