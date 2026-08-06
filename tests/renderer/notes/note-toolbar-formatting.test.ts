import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  updateCodeBlockLanguageCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from '@milkdown/preset-commonmark'
import {
  insertTableCommand,
  toggleStrikethroughCommand
} from '@milkdown/preset-gfm'
import { setBlockType, toggleMark } from '@milkdown/prose/commands'
import { wrapInList } from '@milkdown/prose/schema-list'
import { EditorState, TextSelection, type Command } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import {
  createMarkdownCodec,
  type MarkdownCodec
} from '../../../src/renderer/src/features/notes/markdownCodec'
import {
  getNoteFormatState,
  toggleTaskListItems
} from '../../../src/renderer/src/features/notes/noteFormatting'
import {
  createNoteZoomShortcutPlugin,
  parseNoteFontScale,
  stepNoteFontScale
} from '../../../src/renderer/src/features/notes/noteZoom'
import {
  createSlashMenuPlugin,
  filterSlashMenuItems,
  slashMenu,
  slashMenuKey
} from '../../../src/renderer/src/features/notes/slashMenuPlugin'
import { NOTE_EDITOR_PLUGINS } from '../../../src/renderer/src/features/notes/noteEditorPlugins'

let codec: MarkdownCodec

beforeAll(async () => {
  const events = new EventTarget()
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
  vi.useFakeTimers()
  codec = await createMarkdownCodec()
  vi.clearAllTimers()
})

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function selectedState(markdown: string, from = 1, to = from): EditorState {
  const document = codec.parse(markdown)
  return EditorState.create({
    doc: document,
    selection: TextSelection.create(document, from, to)
  })
}

function applyCommand(state: EditorState, command: Command): EditorState {
  let nextState = state
  expect(
    command(state, (transaction) => {
      nextState = nextState.apply(transaction)
    })
  ).toBe(true)
  return nextState
}

describe('note toolbar formatting', () => {
  test('uses the verified Milkdown command exports', () => {
    const commandExports = {
      turnIntoTextCommand,
      wrapInHeadingCommand,
      toggleStrongCommand,
      toggleEmphasisCommand,
      toggleStrikethroughCommand,
      wrapInBulletListCommand,
      wrapInOrderedListCommand,
      wrapInBlockquoteCommand,
      toggleLinkCommand,
      insertImageCommand,
      toggleInlineCodeCommand,
      createCodeBlockCommand,
      updateCodeBlockLanguageCommand,
      insertHrCommand,
      insertTableCommand
    }

    expect(Object.keys(commandExports)).toEqual([
      'turnIntoTextCommand',
      'wrapInHeadingCommand',
      'toggleStrongCommand',
      'toggleEmphasisCommand',
      'toggleStrikethroughCommand',
      'wrapInBulletListCommand',
      'wrapInOrderedListCommand',
      'wrapInBlockquoteCommand',
      'toggleLinkCommand',
      'insertImageCommand',
      'toggleInlineCodeCommand',
      'createCodeBlockCommand',
      'updateCodeBlockLanguageCommand',
      'insertHrCommand',
      'insertTableCommand'
    ])
    expect(Object.values(commandExports).every((command) => typeof command === 'function')).toBe(
      true
    )
  })

  test('bold toolbar semantics serialize as Markdown and report active state', () => {
    let state = selectedState('Lecture note\n', 1, 8)
    const strong = state.schema.marks['strong']
    expect(strong).toBeDefined()
    state = applyCommand(state, toggleMark(strong!))

    expect(codec.serialize(state.doc)).toBe('**Lecture** note\n')
    expect(getNoteFormatState(state).strong).toBe(true)
  })

  test('heading toolbar semantics serialize as Markdown and report its level', () => {
    let state = selectedState('Lecture note\n')
    const heading = state.schema.nodes['heading']
    expect(heading).toBeDefined()
    state = applyCommand(state, setBlockType(heading!, { level: 2 }))

    expect(codec.serialize(state.doc)).toBe('## Lecture note\n')
    expect(getNoteFormatState(state).headingLevel).toBe(2)
  })

  test('list and checklist toolbar semantics survive serialization', () => {
    let state = selectedState('Practice\n')
    const bulletList = state.schema.nodes['bullet_list']
    expect(bulletList).toBeDefined()
    state = applyCommand(state, wrapInList(bulletList!))

    const view = {
      get state() {
        return state
      },
      dispatch(transaction: Parameters<EditorView['dispatch']>[0]) {
        state = state.apply(transaction)
      }
    } as unknown as EditorView

    expect(toggleTaskListItems(view)).toBe(true)
    expect(codec.serialize(state.doc)).toContain('* [ ] Practice')
    expect(getNoteFormatState(state).taskList).toBe(true)
  })
})

describe('note slash menu and zoom contracts', () => {
  test('registers the direct slash menu plugin in the editor bundle', () => {
    expect(NOTE_EDITOR_PLUGINS).toContain(slashMenu)
  })

  test('filters slash blocks in Korean and by command keyword', () => {
    expect(filterSlashMenuItems('제목').map((item) => item.command)).toEqual([
      'heading-1',
      'heading-2',
      'heading-3'
    ])
    expect(filterSlashMenuItems('todo').map((item) => item.command)).toEqual([
      'task-list'
    ])
  })

  test('opens only from an empty paragraph and tracks the typed filter', () => {
    const plugin = createSlashMenuPlugin(() => true)
    let state = EditorState.create({ doc: codec.parse(''), plugins: [plugin] })
    const view = {
      get state() {
        return state
      },
      dispatch(transaction: Parameters<EditorView['dispatch']>[0]) {
        state = state.apply(transaction)
      }
    } as unknown as EditorView
    const handleTextInput = plugin.props.handleTextInput

    expect(handleTextInput?.call(plugin, view, 1, 1, '/')).toBe(true)
    expect(slashMenuKey.getState(state)).toMatchObject({
      active: true,
      from: 1,
      query: ''
    })

    view.dispatch(state.tr.insertText('todo', 2))
    expect(slashMenuKey.getState(state)).toMatchObject({
      active: true,
      query: 'todo'
    })
  })

  test('normalizes and steps through the persisted font scale', () => {
    expect(parseNoteFontScale('1.25')).toBe(1.25)
    expect(parseNoteFontScale('7')).toBe(1)
    expect(stepNoteFontScale(1, 1)).toBe(1.125)
    expect(stepNoteFontScale(0.875, -1)).toBe(0.875)
    expect(stepNoteFontScale(1.5, 1)).toBe(1.5)
  })

  test('handles command-plus only through the focused editor keymap', () => {
    const onStep = vi.fn()
    const plugin = createNoteZoomShortcutPlugin(onStep)
    const handler = plugin.props.handleKeyDown
    const event = {
      key: '=',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent

    expect(handler?.call(plugin, {} as EditorView, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(onStep).toHaveBeenCalledWith(1)
  })
})
