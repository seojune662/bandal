// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import { EditorView } from '@milkdown/prose/view'
import { history, undo } from '@milkdown/prose/history'
import {
  createPluginEditorAccess,
  handlePluginEditorRequest,
} from '../../../src/renderer/src/features/plugins/pluginEditor'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { usePluginsStore } from '../../../src/renderer/src/stores/pluginsStore'
import { sanitizePluginManifest } from '../../../src/shared/plugins/sanitize'
import type { PluginEditorRequest } from '../../../src/shared/types/pluginEditor'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: { inline: true },
  },
})
const request = (
  overrides: Partial<PluginEditorRequest> = {},
): PluginEditorRequest => ({
  requestId: 'request',
  pluginId: 'test.editor',
  action: 'getSelection',
  ...overrides,
})
describe('live editor plugin transactions', () => {
  let view: EditorView
  let relPath: string
  let sourcePanelId: string | null
  let extraViews: EditorView[]
  beforeEach(() => {
    relPath = 'note.md'
    sourcePanelId = null
    extraViews = []
    useWorkspaceStore.setState({ activePanelId: null })
    const manifest = sanitizePluginManifest({
      manifestVersion: 2,
      id: 'test.editor',
      name: 'Editor',
      author: 'Test',
      description: '',
      version: '1.0.0',
      minAppVersion: '0.41.2',
      permissions: ['editor.read', 'editor.write'],
      contributes: {},
    }).manifest!
    usePluginsStore.setState({
      plugins: [
        {
          manifest,
          enabled: true,
          state: 'active',
          approvedPermissions: manifest.permissions,
          installedAt: '',
          lastError: null,
        },
      ],
    })
    vi.spyOn(
      useWorkspaceStore.getState(),
      'activeTabDescriptor',
    ).mockImplementation(() => ({
      kind: 'note',
      payload: { courseId: 'course', relPath },
    }))
    vi.spyOn(
      useWorkspaceStore.getState(),
      'activePanelSource',
    ).mockImplementation(() => sourcePanelId ? {
      panelId: sourcePanelId,
      descriptor: {
        kind: 'note',
        payload: { courseId: 'course', relPath },
      },
    } : null)
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('Hello world')),
    ])
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1, 6),
      plugins: [
        history(),
        createPluginEditorAccess('course', () => relPath, 'original'),
      ],
    })
    view = new EditorView(document.body, { state })
    vi.spyOn(view.dom, 'getClientRects').mockReturnValue([
      { width: 100 },
    ] as unknown as DOMRectList)
    // jsdom has no layout engine; editing and undo still use real PM state.
    vi.spyOn(view, 'scrollToSelection').mockImplementation(() => undefined)
  })
  afterEach(() => {
    view.destroy()
    for (const extra of extraViews) extra.destroy()
    vi.restoreAllMocks()
    usePluginsStore.setState({ plugins: [] })
    useWorkspaceStore.setState({ activePanelId: null })
  })
  const duplicate = (
    panelId?: string,
    from = 7,
    to = 12,
  ): EditorView => {
    const state = EditorState.create({
      schema,
      doc: view.state.doc,
      selection: TextSelection.create(view.state.doc, from, to),
      plugins: [createPluginEditorAccess('course', () => relPath, panelId)],
    })
    const result = new EditorView(document.body, { state })
    extraViews.push(result)
    vi.spyOn(result.dom, 'getClientRects').mockReturnValue([
      { width: 100 },
    ] as unknown as DOMRectList)
    vi.spyOn(result, 'scrollToSelection').mockImplementation(() => undefined)
    return result
  }
  test('the exact active duplicate wins over the most recently focused note', () => {
    const other = duplicate('duplicate')
    sourcePanelId = 'original'
    other.dom.dispatchEvent(new Event('focus'))
    expect(handlePluginEditorRequest(request())?.text).toBe('Hello')

    sourcePanelId = 'duplicate'
    view.dom.dispatchEvent(new Event('focus'))
    const selection = handlePluginEditorRequest(request())!
    expect(selection.text).toBe('world')
    handlePluginEditorRequest(request({
      action: 'replaceSelection',
      token: selection.token,
      text: 'Bandal',
    }))
    expect(other.state.doc.textContent).toBe('Hello Bandal')
    expect(view.state.doc.textContent).toBe('Hello world')
  })
  test('a token cannot cross duplicate panels with identical documents and selections', () => {
    const other = duplicate('duplicate', 1, 6)
    sourcePanelId = 'original'
    const selection = handlePluginEditorRequest(request())!
    sourcePanelId = 'duplicate'
    expect(() => handlePluginEditorRequest(request({
      action: 'replaceSelection',
      token: selection.token,
      text: 'Unexpected',
    }))).toThrow('changed')
    expect(other.state.doc.textContent).toBe('Hello world')
    expect(view.state.doc.textContent).toBe('Hello world')
  })
  test('a real panel ID never falls back to another visible duplicate', () => {
    duplicate()
    sourcePanelId = 'missing-panel'
    expect(handlePluginEditorRequest(request())).toBeNull()
    expect(() => handlePluginEditorRequest(request({
      action: 'replaceSelection',
      token: 'missing-token',
      text: 'Unexpected',
    }))).toThrow('no longer active')

    sourcePanelId = null
    useWorkspaceStore.setState({ activePanelId: 'missing-panel' })
    expect(handlePluginEditorRequest(request())).toBeNull()
  })
  test('older adapters without panel IDs retain their active-note fallback', () => {
    const other = duplicate()
    other.dom.dispatchEvent(new Event('focus'))
    expect(handlePluginEditorRequest(request())?.text).toBe('world')
  })
  test('replacement is one undoable edit and its token is single-use', () => {
    const selection = handlePluginEditorRequest(request())!
    expect(selection.text).toBe('Hello')
    handlePluginEditorRequest(
      request({
        action: 'replaceSelection',
        token: selection.token,
        text: 'Goodbye',
      }),
    )
    expect(view.state.doc.textContent).toBe('Goodbye world')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.textContent).toBe('Hello world')
    expect(() =>
      handlePluginEditorRequest(
        request({
          action: 'replaceSelection',
          token: selection.token,
          text: 'Again',
        }),
      ),
    ).toThrow('changed')
  })
  test.each(['document', 'selection', 'path', 'owner', 'permission'] as const)(
    'rejects a stale or unauthorized %s',
    (change) => {
      const selection = handlePluginEditorRequest(request())!
      if (change === 'document') view.dispatch(view.state.tr.insertText('!', 8))
      if (change === 'selection')
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, 2, 3),
          ),
        )
      if (change === 'path') relPath = 'renamed.md'
      if (change === 'permission') usePluginsStore.setState({ plugins: [] })
      expect(() =>
        handlePluginEditorRequest(
          request({
            action: 'replaceSelection',
            token: selection.token,
            text: 'Unexpected',
            ...(change === 'owner' ? { pluginId: 'other.plugin' } : {}),
          }),
        ),
      ).toThrow()
      expect(view.state.doc.textContent).not.toContain('Unexpected')
    },
  )
})
