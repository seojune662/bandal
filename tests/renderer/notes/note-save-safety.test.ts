import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { NoteFlushResult } from '../../../src/renderer/src/features/notes/noteSaveSafety'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: invokeMock
}))

import {
  createNoteConflictCopy,
  preserveNoteOnClose,
  registerNoteFlushTriggers
} from '../../../src/renderer/src/features/notes/noteSaveSafety'

const NOTE_REF = {
  courseId: 'course-1',
  relPath: '수업/중간고사.md'
}

describe('note save safety', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  test('reports a write failure through the app notifier after the tab unmounts', async () => {
    let finishFlush: (result: NoteFlushResult) => void = () => undefined
    let mounted = true
    const notify = vi.fn(() => {
      expect(mounted).toBe(false)
    })
    const pending = preserveNoteOnClose({
      flush: () =>
        new Promise<NoteFlushResult>((resolve) => {
          finishFlush = resolve
        }),
      snapshot: () => ({
        ref: NOTE_REF,
        markdown: '마지막 편집',
        persistedMarkdown: '이전 내용',
        conflict: false
      }),
      createConflictCopy: vi.fn(),
      notify
    })

    mounted = false
    finishFlush({ status: 'error', detail: 'disk full' })

    await expect(pending).resolves.toEqual({
      status: 'failed',
      reason: 'write'
    })
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('수업/중간고사.md'),
      'danger'
    )
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('disk full'),
      'danger'
    )
  })

  test('flushes immediately on blur and hidden without blocking beforeunload', () => {
    const windowTarget = new EventTarget()
    const documentTarget = new EventTarget()
    const flush = vi.fn()
    const close = vi.fn()
    let visibilityState: DocumentVisibilityState = 'visible'
    const dispose = registerNoteFlushTriggers({
      windowTarget,
      documentTarget,
      visibilityState: () => visibilityState,
      flush,
      close
    })

    windowTarget.dispatchEvent(new Event('blur'))
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    visibilityState = 'hidden'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    windowTarget.dispatchEvent(beforeUnload)

    expect(flush).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
    expect(beforeUnload.defaultPrevented).toBe(false)

    dispose()
    windowTarget.dispatchEvent(new Event('blur'))
    expect(flush).toHaveBeenCalledTimes(2)
  })

  test('preserves conflict edits in a copy when the tab closes', async () => {
    const createConflictCopy = vi.fn().mockResolvedValue({
      courseId: 'course-1',
      relPath: '수업/중간고사 (충돌 사본).md'
    })
    const notify = vi.fn()

    await expect(
      preserveNoteOnClose({
        flush: async () => ({
          status: 'conflict',
          detail: 'mtime changed'
        }),
        snapshot: () => ({
          ref: NOTE_REF,
          markdown: '충돌 뒤에도 계속 쓴 내용',
          persistedMarkdown: '디스크에 있던 내 이전 내용',
          conflict: true
        }),
        createConflictCopy,
        notify
      })
    ).resolves.toEqual({
      status: 'copied',
      copy: {
        courseId: 'course-1',
        relPath: '수업/중간고사 (충돌 사본).md'
      }
    })
    expect(createConflictCopy).toHaveBeenCalledWith(
      NOTE_REF,
      '충돌 뒤에도 계속 쓴 내용'
    )
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('수업/중간고사 (충돌 사본).md'),
      'info'
    )
  })

  test('uses notes:create collision avoidance before writing the conflict copy', async () => {
    invokeMock
      .mockResolvedValueOnce({
        courseId: 'course-1',
        relPath: '수업/중간고사 (충돌 사본)-2.md'
      })
      .mockResolvedValueOnce({ mtime: 123 })

    await expect(
      createNoteConflictCopy(NOTE_REF, '보존할 원문 전체')
    ).resolves.toEqual({
      courseId: 'course-1',
      relPath: '수업/중간고사 (충돌 사본)-2.md'
    })
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'notes:create', {
      courseId: 'course-1',
      dirRelPath: '수업',
      title: '중간고사 (충돌 사본)'
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'notes:write', {
      courseId: 'course-1',
      relPath: '수업/중간고사 (충돌 사본)-2.md',
      markdown: '보존할 원문 전체'
    })
  })
})
