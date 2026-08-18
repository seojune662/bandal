import { describe, expect, test, vi } from 'vitest'
import {
  broadcastNoteEdit,
  broadcastNoteSave,
  claimNoteWriter,
  currentNoteWriter,
  isNoteWriter,
  noteDocPeerCount,
  noteFileKey,
  subscribeNoteDoc,
  type NoteDocPeerHandlers
} from '../../../src/renderer/src/features/notes/noteDocChannel'

function handlers(): NoteDocPeerHandlers {
  return { onRemoteEdit: vi.fn(), onRemoteSave: vi.fn() }
}

describe('noteFileKey', () => {
  test('separates course and path so lookalike refs stay distinct', () => {
    expect(noteFileKey('c1', 'a.md')).not.toBe(noteFileKey('c1 a', '.md'))
    expect(noteFileKey('c1', 'a.md')).toBe(noteFileKey('c1', 'a.md'))
  })
})

describe('subscription and broadcast', () => {
  test('delivers edits to every peer except the origin', () => {
    const key = noteFileKey('course', 'notes/a.md')
    const a = handlers()
    const b = handlers()
    const c = handlers()
    const offA = subscribeNoteDoc(key, 'panel-a', a)
    const offB = subscribeNoteDoc(key, 'panel-b', b)
    const offC = subscribeNoteDoc(key, 'panel-c', c)

    broadcastNoteEdit(key, 'panel-a', '# live')

    expect(a.onRemoteEdit).not.toHaveBeenCalled()
    expect(b.onRemoteEdit).toHaveBeenCalledWith('# live')
    expect(c.onRemoteEdit).toHaveBeenCalledWith('# live')
    offA()
    offB()
    offC()
  })

  test('delivers saves (markdown + mtime) to every peer except the origin', () => {
    const key = noteFileKey('course', 'notes/b.md')
    const a = handlers()
    const b = handlers()
    const offA = subscribeNoteDoc(key, 'panel-a', a)
    const offB = subscribeNoteDoc(key, 'panel-b', b)

    broadcastNoteSave(key, 'panel-a', '# saved', 42)

    expect(a.onRemoteSave).not.toHaveBeenCalled()
    expect(b.onRemoteSave).toHaveBeenCalledWith('# saved', 42)
    offA()
    offB()
  })

  test('does not cross file keys', () => {
    const keyA = noteFileKey('course', 'a.md')
    const keyB = noteFileKey('course', 'b.md')
    const other = handlers()
    const off = subscribeNoteDoc(keyB, 'panel-b', other)

    broadcastNoteEdit(keyA, 'panel-a', '# a only')

    expect(other.onRemoteEdit).not.toHaveBeenCalled()
    off()
  })

  test('unsubscribe stops delivery and updates the peer count', () => {
    const key = noteFileKey('course', 'notes/c.md')
    const a = handlers()
    const b = handlers()
    const offA = subscribeNoteDoc(key, 'panel-a', a)
    const offB = subscribeNoteDoc(key, 'panel-b', b)
    expect(noteDocPeerCount(key)).toBe(2)

    offB()
    expect(noteDocPeerCount(key)).toBe(1)
    broadcastNoteEdit(key, 'panel-a', '# after')
    expect(b.onRemoteEdit).not.toHaveBeenCalled()

    offA()
    expect(noteDocPeerCount(key)).toBe(0)
  })

  test('a stale unsubscribe does not evict a newer subscription', () => {
    const key = noteFileKey('course', 'notes/d.md')
    const stale = handlers()
    const fresh = handlers()
    const offStale = subscribeNoteDoc(key, 'panel-a', stale)
    const offFresh = subscribeNoteDoc(key, 'panel-a', fresh)

    offStale()
    expect(noteDocPeerCount(key)).toBe(1)
    broadcastNoteEdit(key, 'panel-b', '# still here')
    expect(fresh.onRemoteEdit).toHaveBeenCalledWith('# still here')
    offFresh()
  })
})

describe('single-writer tracking', () => {
  test('any panel may write while no writer is claimed', () => {
    const key = noteFileKey('course', 'writer/none.md')
    const off = subscribeNoteDoc(key, 'panel-a', handlers())
    expect(isNoteWriter(key, 'panel-a')).toBe(true)
    expect(isNoteWriter(key, 'panel-b')).toBe(true)
    off()
  })

  test('the last locally edited panel becomes the sole writer', () => {
    const key = noteFileKey('course', 'writer/handoff.md')
    const offA = subscribeNoteDoc(key, 'panel-a', handlers())
    const offB = subscribeNoteDoc(key, 'panel-b', handlers())

    claimNoteWriter(key, 'panel-a')
    expect(currentNoteWriter(key)).toBe('panel-a')
    expect(isNoteWriter(key, 'panel-a')).toBe(true)
    expect(isNoteWriter(key, 'panel-b')).toBe(false)

    // A edits, then B edits: the writer moves to B.
    claimNoteWriter(key, 'panel-b')
    expect(currentNoteWriter(key)).toBe('panel-b')
    expect(isNoteWriter(key, 'panel-a')).toBe(false)
    expect(isNoteWriter(key, 'panel-b')).toBe(true)
    offA()
    offB()
  })

  test('an edit broadcast marks the origin as writer', () => {
    const key = noteFileKey('course', 'writer/broadcast.md')
    const offA = subscribeNoteDoc(key, 'panel-a', handlers())
    const offB = subscribeNoteDoc(key, 'panel-b', handlers())

    broadcastNoteEdit(key, 'panel-b', '# from b')
    expect(currentNoteWriter(key)).toBe('panel-b')
    offA()
    offB()
  })

  test('unsubscribing the writer releases the claim', () => {
    const key = noteFileKey('course', 'writer/release.md')
    const offA = subscribeNoteDoc(key, 'panel-a', handlers())
    const offB = subscribeNoteDoc(key, 'panel-b', handlers())
    claimNoteWriter(key, 'panel-a')

    offA()
    expect(currentNoteWriter(key)).toBe(null)
    expect(isNoteWriter(key, 'panel-b')).toBe(true)
    offB()
  })
})

describe('writer handoff against a real mtime check', () => {
  interface FakePanel {
    id: string
    markdown: string
    persisted: string
    mtime: number
  }

  test('A saves, B edits next — B saves with the propagated mtime, no conflict', () => {
    const key = noteFileKey('course', 'sim/handoff.md')
    const disk = { markdown: '# start', mtime: 1, writes: 0 }
    const writeToDisk = (markdown: string, expectedMtime: number): number => {
      if (expectedMtime !== disk.mtime) {
        throw Object.assign(new Error('mtime changed'), {
          name: 'ConflictError'
        })
      }
      disk.markdown = markdown
      disk.mtime += 1
      disk.writes += 1
      return disk.mtime
    }

    const makePanel = (id: string): FakePanel => ({
      id,
      markdown: disk.markdown,
      persisted: disk.markdown,
      mtime: disk.mtime
    })
    const a = makePanel('panel-a')
    const b = makePanel('panel-b')

    const wire = (panel: FakePanel): (() => void) =>
      subscribeNoteDoc(key, panel.id, {
        onRemoteEdit: (markdown) => {
          panel.markdown = markdown
          panel.persisted = markdown
        },
        onRemoteSave: (markdown, mtime) => {
          panel.markdown = markdown
          panel.persisted = markdown
          panel.mtime = mtime
        }
      })
    const offA = wire(a)
    const offB = wire(b)

    const editLocally = (panel: FakePanel, markdown: string): void => {
      panel.markdown = markdown
      claimNoteWriter(key, panel.id)
      broadcastNoteEdit(key, panel.id, markdown)
    }
    const flushPanel = (panel: FakePanel): void => {
      if (!isNoteWriter(key, panel.id)) return
      if (panel.markdown === panel.persisted) return
      panel.mtime = writeToDisk(panel.markdown, panel.mtime)
      panel.persisted = panel.markdown
      broadcastNoteSave(key, panel.id, panel.markdown, panel.mtime)
    }

    // A types and saves.
    editLocally(a, '# start\n\nfrom A')
    expect(b.markdown).toBe('# start\n\nfrom A')
    flushPanel(a)
    expect(b.mtime).toBe(disk.mtime)

    // B types next: the writer moves, and B's save uses the propagated
    // mtime — it must NOT throw ConflictError.
    editLocally(b, '# start\n\nfrom A\n\nfrom B')
    expect(currentNoteWriter(key)).toBe('panel-b')
    expect(() => flushPanel(b)).not.toThrow()
    expect(disk.markdown).toBe('# start\n\nfrom A\n\nfrom B')
    expect(disk.writes).toBe(2)

    // A is no longer the writer: its flush is a no-op, not a competing write.
    flushPanel(a)
    expect(disk.writes).toBe(2)
    offA()
    offB()
  })
})
