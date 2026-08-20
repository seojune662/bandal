/**
 * What ⌘P means, per tab.
 *
 * The most load-bearing pure function in the print feature: its answer decides
 * whether 파일 ▸ 인쇄… is enabled, and an ENABLED macOS menu item consumes ⌘P
 * before the renderer ever sees it. So returning a target here is literally
 * what takes ⌘P away from 빠른 파일 검색 — and returning null is what gives it
 * back.
 */
import { describe, expect, test } from 'vitest'
import { printTargetFor } from '../../../src/renderer/src/features/print/printTarget'
import type { TabDescriptor } from '../../../src/shared/tabs'

const descriptor = (kind: string, payload: unknown): TabDescriptor =>
  ({ kind, payload }) as TabDescriptor

describe('printTargetFor', () => {
  test('a browser tab prints its page', () => {
    expect(
      printTargetFor(
        descriptor('browser', { tabId: 't1', initialUrl: 'https://x/' })
      )
    ).toEqual({ kind: 'browser', tabId: 't1' })
  })

  test('a PDF tab prints the file itself, not a re-render', () => {
    expect(
      printTargetFor(descriptor('pdf', { courseId: 'ds', relPath: '3주차.pdf' }))
    ).toEqual({ kind: 'pdf', courseId: 'ds', relPath: '3주차.pdf' })
  })

  test('everything else leaves ⌘P to 빠른 파일 검색', () => {
    // Each of these would cost the shortcut its meaning for no printable page.
    for (const kind of [
      'note',
      'board',
      'chat',
      'group-chat',
      'whiteboard',
      'image',
      'file'
    ]) {
      expect(printTargetFor(descriptor(kind, { courseId: 'ds' }))).toBeNull()
    }
  })

  test('no focused tab prints nothing', () => {
    expect(printTargetFor(null)).toBeNull()
  })
})
