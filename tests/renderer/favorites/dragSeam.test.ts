/**
 * Interop test for the tab → left-rail drag seam.
 *
 * The producer (workspace/tabDrag.ts) and the consumer
 * (courses/favoriteDrop.ts) were written independently against the same MIME
 * type but drifted on the payload shape: the producer emits
 * `{ descriptor, label }` while the consumer originally required
 * `version === 1` and returned null otherwise. Both sides' own unit tests
 * passed, and dragging a tab onto the sidebar silently did nothing.
 *
 * This test deliberately spans both modules — that is the whole point.
 */

import { describe, expect, test } from 'vitest'
import {
  BANDAL_TAB_DRAG_MIME,
  writeWorkspaceTabDragData
} from '../../../src/renderer/src/features/workspace/tabDrag'
import {
  parseFavoriteDragPayload,
  serializeFavoriteTabDrag
} from '../../../src/renderer/src/features/courses/favoriteDrop'
import type { TabDescriptor } from '../../../src/shared/tabs'

/** Minimal DataTransfer stand-in; jsdom is not available in this suite. */
function fakeDataTransfer(): DataTransfer & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    effectAllowed: 'move',
    setData: (format: string, data: string) => store.set(format, data),
    getData: (format: string) => store.get(format) ?? ''
  } as unknown as DataTransfer & { store: Map<string, string> }
}

const DESCRIPTORS: TabDescriptor[] = [
  { kind: 'pdf', payload: { courseId: 'c1', relPath: 'Chap1.pdf' } },
  { kind: 'note', payload: { courseId: 'c1', relPath: '필기.md' } },
  {
    kind: 'browser',
    payload: { tabId: 't1', initialUrl: 'https://www.youtube.com' }
  },
  { kind: 'chat', payload: { courseId: 'c1' } },
  { kind: 'board', payload: {} },
  { kind: 'whiteboard', payload: { courseId: 'c1', boardId: 'wb1' } },
  {
    kind: 'group-chat',
    payload: { courseId: 'c1', groupId: 'group1', view: 'chat' }
  }
]

describe('tab → favorites drag seam', () => {
  test.each(DESCRIPTORS)(
    'what the tab strip writes, the sidebar can read ($kind)',
    (descriptor) => {
      const transfer = fakeDataTransfer()
      writeWorkspaceTabDragData(transfer, descriptor, 'label')

      expect(transfer.effectAllowed).toBe('copyMove')
      const raw = transfer.getData(BANDAL_TAB_DRAG_MIME)
      expect(raw).not.toBe('')
      expect(parseFavoriteDragPayload(raw)).toEqual(descriptor)
    }
  )

  test("the sidebar's own versioned payload still round-trips", () => {
    const descriptor = DESCRIPTORS[0] as TabDescriptor
    expect(parseFavoriteDragPayload(serializeFavoriteTabDrag(descriptor))).toEqual(
      descriptor
    )
  })

  test('a future payload version is rejected rather than half-read', () => {
    const raw = JSON.stringify({ version: 99, descriptor: DESCRIPTORS[0] })
    expect(parseFavoriteDragPayload(raw)).toBeNull()
  })

  test('hostile or malformed payloads never throw', () => {
    for (const raw of ['', 'null', '{', '[]', '{"descriptor":{"kind":"nope"}}']) {
      expect(parseFavoriteDragPayload(raw)).toBeNull()
    }
  })
})
