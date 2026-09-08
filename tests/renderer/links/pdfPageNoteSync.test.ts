// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  publishPageSyncAnchor,
  subscribePageSyncAnchor,
  type PageSyncAnchor
} from '../../../src/renderer/src/features/links/pdfPageNoteSync'

describe('PDF page-note scroll event coordinator', () => {
  let queuedFrame: FrameRequestCallback | null

  beforeEach(() => {
    queuedFrame = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      queuedFrame = callback
      return 1
    })
  })

  test('delivers only the latest anchor for a pair during one frame', () => {
    const received: PageSyncAnchor[] = []
    const stop = subscribePageSyncAnchor('pair-1', (anchor) => {
      received.push(anchor)
    })

    publishPageSyncAnchor({
      connectionId: 'connection-1',
      pairId: 'pair-1',
      page: 4,
      pageOffset: 0.1,
      originPanelId: 'pdf-panel'
    })
    publishPageSyncAnchor({
      connectionId: 'connection-1',
      pairId: 'pair-1',
      page: 4,
      pageOffset: 0.72,
      originPanelId: 'pdf-panel'
    })

    expect(received).toEqual([])
    expect(queuedFrame).not.toBeNull()
    ;(queuedFrame as FrameRequestCallback)(16)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ page: 4, pageOffset: 0.72 })
    stop()
  })

  test('keeps independent pairs while coalescing the frame', () => {
    const first: PageSyncAnchor[] = []
    const second: PageSyncAnchor[] = []
    const stopFirst = subscribePageSyncAnchor('pair-a', (anchor) => first.push(anchor))
    const stopSecond = subscribePageSyncAnchor('pair-b', (anchor) => second.push(anchor))

    publishPageSyncAnchor({
      connectionId: 'connection-a',
      pairId: 'pair-a',
      page: 2,
      pageOffset: 0.2,
      originPanelId: 'note-a'
    })
    publishPageSyncAnchor({
      connectionId: 'connection-b',
      pairId: 'pair-b',
      page: 8,
      pageOffset: 0.8,
      originPanelId: 'note-b'
    })
    ;(queuedFrame as FrameRequestCallback)(16)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    stopFirst()
    stopSecond()
  })
})
