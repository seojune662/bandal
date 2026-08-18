import { describe, expect, test, vi } from 'vitest'
import type { NoteRef } from '../../../src/shared/types/note'
import type { NoteFlushResult } from '../../../src/renderer/src/features/notes/noteSaveSafety'
import {
  flushOpenNoteSession,
  openNotePanelId,
  openNoteRefForPanel,
  openNoteSessionsForFile,
  registerOpenNoteSession,
  retargetOpenNoteSession
} from '../../../src/renderer/src/features/notes/noteSessionRegistry'

interface FakeSession {
  panelId: string
  ref: NoteRef
  flushResult: NoteFlushResult
}

function makeSession(
  panelId: string,
  ref: NoteRef,
  flushResult: NoteFlushResult = { status: 'saved' }
): {
  session: {
    panelId: string
    flush: ReturnType<typeof vi.fn>
    ref: () => NoteRef
    retarget: ReturnType<typeof vi.fn>
  }
  state: FakeSession
} {
  const state: FakeSession = { panelId, ref: { ...ref }, flushResult }
  const session = {
    panelId,
    flush: vi.fn(async () => state.flushResult),
    ref: () => state.ref,
    retarget: vi.fn((relPath: string) => {
      state.ref = { ...state.ref, relPath }
    })
  }
  return { session, state }
}

const fileRef: NoteRef = { courseId: 'course-1', relPath: 'notes/a.md' }
const otherRef: NoteRef = { courseId: 'course-1', relPath: 'notes/b.md' }

describe('multi-session registration', () => {
  test('two panels on the same file register independent sessions', () => {
    const a = makeSession('panel-a', fileRef)
    const b = makeSession('panel-b::duplicate::uuid', fileRef)
    const offA = registerOpenNoteSession(fileRef, a.session)
    const offB = registerOpenNoteSession(fileRef, b.session)

    expect(openNoteSessionsForFile(fileRef)).toHaveLength(2)
    expect(openNoteRefForPanel('panel-a')).toEqual(fileRef)
    expect(openNoteRefForPanel('panel-b::duplicate::uuid')).toEqual(fileRef)
    offA()
    offB()
    expect(openNoteSessionsForFile(fileRef)).toHaveLength(0)
  })

  test('openNotePanelId returns the most recently registered panel', () => {
    const a = makeSession('panel-a', fileRef)
    const b = makeSession('panel-b', fileRef)
    const offA = registerOpenNoteSession(fileRef, a.session)
    const offB = registerOpenNoteSession(fileRef, b.session)

    expect(openNotePanelId(fileRef)).toBe('panel-b')
    offB()
    expect(openNotePanelId(fileRef)).toBe('panel-a')
    offA()
    expect(openNotePanelId(fileRef)).toBe(null)
  })

  test('sessions on other files are not mixed in', () => {
    const a = makeSession('panel-a', fileRef)
    const other = makeSession('panel-x', otherRef)
    const offA = registerOpenNoteSession(fileRef, a.session)
    const offOther = registerOpenNoteSession(otherRef, other.session)

    expect(openNoteSessionsForFile(fileRef)).toHaveLength(1)
    expect(openNotePanelId(otherRef)).toBe('panel-x')
    offA()
    offOther()
  })

  test('a stale unregister does not evict a replacing session', () => {
    const first = makeSession('panel-a', fileRef)
    const second = makeSession('panel-a', fileRef)
    const offFirst = registerOpenNoteSession(fileRef, first.session)
    const offSecond = registerOpenNoteSession(fileRef, second.session)

    offFirst()
    expect(openNoteRefForPanel('panel-a')).toEqual(fileRef)
    offSecond()
    expect(openNoteRefForPanel('panel-a')).toBe(null)
  })
})

describe('flushOpenNoteSession', () => {
  test('flushes every session of the file and aggregates the result', async () => {
    const a = makeSession('panel-a', fileRef)
    const b = makeSession('panel-b', fileRef, { status: 'unavailable' })
    const offA = registerOpenNoteSession(fileRef, a.session)
    const offB = registerOpenNoteSession(fileRef, b.session)

    const flushed = await flushOpenNoteSession(fileRef)
    expect(a.session.flush).toHaveBeenCalledTimes(1)
    expect(b.session.flush).toHaveBeenCalledTimes(1)
    expect(flushed?.result).toEqual({ status: 'saved' })
    expect(flushed?.ref).toEqual(fileRef)
    offA()
    offB()
  })

  test('a conflict from any session dominates the aggregate', async () => {
    const conflict: NoteFlushResult = {
      status: 'conflict',
      detail: '디스크의 파일이 편집 중 변경되었습니다.'
    }
    const a = makeSession('panel-a', fileRef)
    const b = makeSession('panel-b', fileRef, conflict)
    const offA = registerOpenNoteSession(fileRef, a.session)
    const offB = registerOpenNoteSession(fileRef, b.session)

    const flushed = await flushOpenNoteSession(fileRef)
    expect(flushed?.result).toEqual(conflict)
    offA()
    offB()
  })

  test('returns null when no session shows the file', async () => {
    expect(await flushOpenNoteSession(fileRef)).toBe(null)
  })
})

describe('retargetOpenNoteSession', () => {
  test('retargets every session of the file', () => {
    const a = makeSession('panel-a', fileRef)
    const b = makeSession('panel-b', fileRef)
    const other = makeSession('panel-x', otherRef)
    const offA = registerOpenNoteSession(fileRef, a.session)
    const offB = registerOpenNoteSession(fileRef, b.session)
    const offOther = registerOpenNoteSession(otherRef, other.session)

    const moved = retargetOpenNoteSession(fileRef, 'notes/renamed.md', 7)

    expect(moved).toBe(true)
    expect(a.session.retarget).toHaveBeenCalledWith('notes/renamed.md', 7)
    expect(b.session.retarget).toHaveBeenCalledWith('notes/renamed.md', 7)
    expect(other.session.retarget).not.toHaveBeenCalled()
    // Follow-up lookups see the sessions under the NEW path.
    expect(
      openNoteSessionsForFile({ courseId: 'course-1', relPath: 'notes/renamed.md' })
    ).toHaveLength(2)
    expect(openNoteSessionsForFile(fileRef)).toHaveLength(0)
    offA()
    offB()
    offOther()
  })

  test('reports false when nothing matches', () => {
    expect(retargetOpenNoteSession(fileRef, 'notes/renamed.md')).toBe(false)
  })
})
