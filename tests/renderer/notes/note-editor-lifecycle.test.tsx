// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'

const milkdownState = vi.hoisted(() => ({ factoryChanges: 0 }))

vi.mock('@milkdown/react', async () => {
  const ReactModule = await import('react')
  return {
    Milkdown: () => ReactModule.createElement('div', { 'data-milkdown': true }),
    MilkdownProvider: ({ children }: { children: React.ReactNode }) => children,
    useEditor: (
      _factory: unknown,
      dependencies: React.DependencyList = []
    ) => {
      ReactModule.useLayoutEffect(() => {
        milkdownState.factoryChanges += 1
      }, dependencies)
      return { get: () => undefined, loading: false }
    }
  }
})

vi.mock('../../../src/renderer/src/features/notes/noteEditorPlugins', () => ({
  loadNoteEditorPlugins: () => Promise.resolve([]),
  NOTE_EDITOR_PLUGINS: []
}))

import { MilkdownNoteEditor } from '../../../src/renderer/src/features/notes/NoteTab'

let root: Root | null = null

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  milkdownState.factoryChanges = 0
})

describe('MilkdownNoteEditor lifecycle', () => {
  test('does not recreate the editor when its serialized markdown prop echoes a local edit', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onMarkdownChange = vi.fn()
    const onFormatStateChange = vi.fn()
    const onZoomStep = vi.fn()

    const renderEditor = (initialMarkdown: string): React.ReactNode => (
      <MilkdownNoteEditor
        courseId="course-1"
        relPath="lecture pages.md"
        initialMarkdown={initialMarkdown}
        onMarkdownChange={onMarkdownChange}
        onFormatStateChange={onFormatStateChange}
        onZoomStep={onZoomStep}
        autoFocus={false}
      />
    )

    await act(async () => {
      root?.render(renderEditor('ㅎ'))
      await Promise.resolve()
    })
    const changesAfterInitialization = milkdownState.factoryChanges

    await act(async () => {
      root?.render(renderEditor('한'))
      await Promise.resolve()
    })

    expect(changesAfterInitialization).toBeGreaterThan(0)
    expect(milkdownState.factoryChanges).toBe(changesAfterInitialization)
  })
})
