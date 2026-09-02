// @vitest-environment jsdom
/**
 * Mounts the real note editor plugin set (schema + remark + `$view` + `$ctx`)
 * so the wikilink chip is exercised the way NoteTab loads it, not through
 * the headless codec alone.
 */
import { describe, expect, test } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
  serializerCtx
} from '@milkdown/core'
import { NOTE_EDITOR_PLUGINS } from '../../../src/renderer/src/features/notes/noteEditorPlugins'
import { wikilinkContextCtx } from '../../../src/renderer/src/features/notes/wikilink'
import { primeWikilinkFiles } from '../../../src/renderer/src/features/notes/wikilink/wikilinkResolverStore'

const COURSE_ID = 'course-1'
const MARKDOWN = '본문 [[Chap1|별칭]] 과 [[없음]] 및 ![[그림.png]]\n'

describe('wikilink editor integration', () => {
  test('renders chips through the node view and serializes back unchanged', async () => {
    primeWikilinkFiles(COURSE_ID, [
      { relPath: 'Chap1.md', name: 'Chap1.md', kind: 'note' }
    ])
    const root = document.createElement('div')
    document.body.append(root)
    const editor = Editor.make().config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, MARKDOWN)
      ctx.set(wikilinkContextCtx.key, {
        courseId: COURSE_ID,
        getSelfRelPath: () => 'me.md'
      })
    })

    const created = await NOTE_EDITOR_PLUGINS.reduce(
      (instance, plugin) => instance.use(plugin),
      editor
    ).create()

    const chips = [...root.querySelectorAll<HTMLElement>('.note-wikilink')]
    expect(chips.map((chip) => chip.dataset['resolved'])).toEqual([
      'true',
      'false',
      'false'
    ])
    expect(
      chips.map((chip) => chip.querySelector('.note-wikilink__label')?.textContent)
    ).toEqual(['별칭', '없음', '그림.png'])
    expect(chips[2]?.querySelector('.note-wikilink__embed')?.textContent).toBe(
      '임베드'
    )
    expect(chips[0]?.querySelector<HTMLElement>('.note-wikilink__embed')?.hidden).toBe(
      true
    )

    const serialized = created.action((ctx) =>
      ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)
    )
    expect(serialized).toBe(MARKDOWN)
    await created.destroy()
    root.remove()
  })
})
