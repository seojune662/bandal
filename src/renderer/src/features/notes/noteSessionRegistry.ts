import type { NoteRef } from '../../../../shared/types/note'
import type { NoteFlushResult } from './noteSaveSafety'

interface OpenNoteSession {
  panelId: string
  flush: () => Promise<NoteFlushResult>
  ref: () => NoteRef
  retarget: (relPath: string, mtime?: number) => void
}

export interface OpenNoteFlush {
  result: NoteFlushResult
  ref: NoteRef
}

const openNoteSessions = new Map<string, OpenNoteSession>()

function sessionKey(ref: NoteRef): string {
  return `${ref.courseId}\u0000${ref.relPath}`
}

export function registerOpenNoteSession(
  ref: NoteRef,
  session: OpenNoteSession
): () => void {
  openNoteSessions.set(sessionKey(ref), session)
  return () => {
    for (const [key, registered] of openNoteSessions) {
      if (registered === session) openNoteSessions.delete(key)
    }
  }
}

export async function flushOpenNoteSession(
  ref: NoteRef
): Promise<OpenNoteFlush | null> {
  const session = openNoteSessions.get(sessionKey(ref))
  if (session === undefined) return null
  const result = await session.flush()
  return { result, ref: session.ref() }
}

export function openNotePanelId(ref: NoteRef): string | null {
  return openNoteSessions.get(sessionKey(ref))?.panelId ?? null
}

export function openNoteRefForPanel(panelId: string): NoteRef | null {
  for (const session of new Set(openNoteSessions.values())) {
    if (session.panelId === panelId) return session.ref()
  }
  return null
}

/** Moves the live session before its old panel is closed after a disk rename. */
export function retargetOpenNoteSession(
  ref: NoteRef,
  relPath: string,
  mtime?: number
): boolean {
  const oldKey = sessionKey(ref)
  const session = openNoteSessions.get(oldKey)
  if (session === undefined) return false

  openNoteSessions.delete(oldKey)
  openNoteSessions.set(sessionKey({ courseId: ref.courseId, relPath }), session)
  session.retarget(relPath, mtime)
  return true
}
