// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MaterialHoverPreview } from '../../../src/shared/types/materialHoverPreview'
import type { NoteRef } from '../../../src/shared/types/note'

const harness = vi.hoisted(() => ({
  invoke: vi.fn(),
  snapshots: [] as Array<NoteRef & { markdown: string }>,
  remoteEdit: null as ((text: string) => void) | null,
  thumbnail: vi.fn(),
  reference: vi.fn(),
  unsubscribe: vi.fn()
}))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: harness.invoke, onPush: () => () => undefined }))
vi.mock('../../../src/renderer/src/features/notes/noteSessionRegistry', () => ({ readOpenNoteSnapshots: () => harness.snapshots }))
vi.mock('../../../src/renderer/src/features/notes/noteDocChannel', () => ({
  noteFileKey: (courseId: string, path: string) => `${courseId}:${path}`,
  subscribeNoteDoc: (_key: string, _panel: string, handlers: { onRemoteEdit: (text: string) => void }) => {
    harness.remoteEdit = handlers.onRemoteEdit
    return harness.unsubscribe
  }
}))
vi.mock('../../../src/renderer/src/features/materials/preview/markdownPreview', () => ({
  markdownPreviewFragment: async (text: string) => { const fragment = document.createDocumentFragment(); fragment.append(text); return fragment }
}))
vi.mock('../../../src/renderer/src/features/materials/preview/mediaThumbnails', () => ({
  loadPdfThumbnail: harness.thumbnail,
  loadVideoThumbnail: harness.thumbnail,
  loadImageThumbnail: harness.thumbnail,
  loadReferencedThumbnail: harness.reference
}))
import { MaterialPreviewContent, WhiteboardPreviewContent } from '../../../src/renderer/src/features/materials/preview/MaterialPreviewContent'

let container: HTMLDivElement
let root: Root
function result(path: string, text: string): MaterialHoverPreview {
  return { name: path, relPath: path, size: 10, mtime: 100, content: { kind: 'text', text, truncated: false } }
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  harness.invoke.mockReset()
  harness.snapshots = []
  harness.unsubscribe.mockReset()
  harness.remoteEdit = null
  harness.thumbnail.mockReset()
  harness.reference.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers() })

describe('material hover preview content', () => {
  test('ignores an old file response after switching rows', async () => {
    let finishFirst!: (value: MaterialHoverPreview) => void
    harness.invoke.mockImplementation((_channel, request) => request.relPath === 'a.txt'
      ? new Promise((resolve) => { finishFirst = resolve })
      : Promise.resolve(result('b.txt', '현재 자료 내용')))
    const metadata = vi.fn()
    await act(async () => root.render(<MaterialPreviewContent courseId="c" node={{ name: 'a.txt', relPath: 'a.txt', kind: 'other' }} onMetadata={metadata} />))
    await act(async () => root.render(<MaterialPreviewContent courseId="c" node={{ name: 'b.txt', relPath: 'b.txt', kind: 'other' }} onMetadata={metadata} />))
    await act(async () => finishFirst(result('a.txt', '오래된 응답')))
    expect(container.textContent).toBe('현재 자료 내용')
    expect(metadata).toHaveBeenCalledTimes(1)
  })

  test('shows unsaved live markdown and subsequent edits without saving', async () => {
    harness.snapshots = [{ courseId: 'c', relPath: 'note.md', markdown: '저장 전 최신 내용' }]
    harness.invoke.mockResolvedValue(result('note.md', '디스크의 옛 내용'))
    await act(async () => root.render(<MaterialPreviewContent courseId="c" node={{ name: 'note.md', relPath: 'note.md', kind: 'note' }} />))
    expect(container.textContent).toBe('저장 전 최신 내용')
    await act(async () => harness.remoteEdit?.('미리보기 중 새 편집'))
    expect(container.textContent).toBe('미리보기 중 새 편집')
    expect(harness.invoke.mock.calls.map(([channel]) => channel)).toEqual(['materials:hoverPreview'])
  })

  test('reads recording captions without control, transcription or playback', async () => {
    harness.invoke.mockImplementation((channel) => {
      if (channel === 'materials:hoverPreview') return Promise.resolve({ ...result('음성.wav', ''), content: { kind: 'recording' } })
      if (channel === 'recordings:resolve') return Promise.resolve({ id: 'recording-1' })
      return Promise.resolve({ session: { samples: 32000 }, segments: [{ text: '강의 자막 앞부분' }] })
    })
    await act(async () => root.render(<MaterialPreviewContent courseId="c" node={{ name: '음성.wav', relPath: '음성.wav', kind: 'other' }} />))
    expect(container.textContent).toContain('강의 자막 앞부분')
    expect(container.textContent).toContain('00:00:02')
    expect(harness.invoke.mock.calls.map(([channel]) => channel)).toEqual(['materials:hoverPreview', 'recordings:resolve', 'recordings:read'])
    expect(container.querySelector('audio, video')).toBeNull()
  })

  test('keeps a successfully loaded PDF visible beyond the loading timeout', async () => {
    vi.useFakeTimers()
    harness.invoke.mockResolvedValue({ ...result('first.pdf', ''), content: { kind: 'pdf' } })
    harness.thumbnail.mockResolvedValue({ dataUrl: 'data:image/png;base64,preview', pageCount: 7 })
    await act(async () => root.render(<MaterialPreviewContent courseId="c" node={{ name: 'first.pdf', relPath: 'first.pdf', kind: 'pdf' }} />))
    expect(container.querySelector('img')?.getAttribute('src')).toContain('base64,preview')
    await act(async () => vi.advanceTimersByTime(11000))
    expect(container.textContent).toBe('1 / 7쪽')
    expect(container.querySelector('img')).not.toBeNull()
  })

  test('shows first-page whiteboard content including local image references', async () => {
    const board = { id: 'board', courseId: 'c', title: '수업', background: 'blank' as const, surface: 'light' as const, pageCount: 2, sortOrder: 0, createdAt: '', updatedAt: '' }
    const shape = { id: 's1', page: 1, kind: 'textbox', data: { box: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 }, text: '첫 페이지 내용' }, style: { color: 'ink', width: 0.01, opacity: 1 }, createdAt: '', updatedAt: '' }
    harness.invoke.mockResolvedValue({ board: { ...board, surface: 'dark', background: 'grid', pageCount: 3 }, shapes: [shape, { ...shape, id: 's2', page: 2, data: { ...shape.data, text: '두 번째 페이지' } }, { ...shape, id: 'image', kind: 'image', data: { box: shape.data.box, image: { relPath: '그림.png', label: '그림' } } }] })
    harness.reference.mockResolvedValue({ dataUrl: 'data:image/png;base64,small-thumbnail' })
    await act(async () => root.render(<WhiteboardPreviewContent courseId="c" board={board} />))
    expect(container.textContent).toContain('첫 페이지 내용')
    expect(container.textContent).not.toContain('두 번째 페이지')
    expect(container.querySelector('svg image')?.getAttribute('href')).toBe('data:image/png;base64,small-thumbnail')
    expect(container.querySelector('[data-surface]')?.getAttribute('data-surface')).toBe('dark')
    expect(container.querySelector('[data-background]')?.getAttribute('data-background')).toBe('grid')
    expect(container.textContent).toContain('1 / 3쪽')
    expect(harness.invoke.mock.calls.map(([channel]) => channel)).toEqual(['canvas:hoverPreview'])
    expect(harness.reference).toHaveBeenCalledWith('c', '그림.png', expect.any(AbortSignal), undefined, undefined)
  })
})
