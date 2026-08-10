/**
 * Glue for the materials sidebar: clicking a file opens it as a
 * workspace tab (pdf/md/images) or reveals it in Finder (other files).
 * Kept here (not in the materials feature)
 * so the sidebar only needs a one-line call.
 */

import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import type { MaterialKind } from '../../../../shared/types/materials'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from './tabIdentity'

export const MATERIAL_OPEN_DEDUPE_MS = 5 * 60 * 1000

const materialOpenRecordedAt = new Map<string, number>()

/** Pure duplicate decision used by the renderer-side activity throttle. */
export function shouldRecordMaterialOpen(
  lastRecordedAt: number | undefined,
  now: number,
  dedupeMs = MATERIAL_OPEN_DEDUPE_MS
): boolean {
  return (
    lastRecordedAt === undefined ||
    now < lastRecordedAt ||
    now - lastRecordedAt >= dedupeMs
  )
}

function recordMaterialOpened(courseId: string, relPath: string): void {
  const key = `${courseId}\u0000${relPath}`
  const now = Date.now()
  if (!shouldRecordMaterialOpen(materialOpenRecordedAt.get(key), now)) return
  materialOpenRecordedAt.set(key, now)

  void invoke('activity:record', {
    courseId,
    kind: 'material-opened',
    relPath,
    summary: `${relPath}을(를) 열었습니다.`
  }).catch(() => {})
}

export function openMaterialInWorkspace(
  kind: MaterialKind,
  relPath: string
): void {
  const courseId = useMaterialsStore.getState().activeCourseId
  if (courseId === null) return
  openMaterialInCourse(courseId, kind, relPath)
}

/**
 * [M6-A] Course-explicit variant for callers that know their course (⌘P
 * quick search) — the materials store's activeCourseId only tracks the
 * sidebar, which may be closed.
 */
export function openMaterialInCourse(
  courseId: string,
  kind: MaterialKind,
  relPath: string
): void {
  if (kind === 'pdf' || kind === 'note' || kind === 'image') {
    useWorkspaceStore.getState().openTab(
      descriptorFor(kind, { courseId, relPath })
    )
    recordMaterialOpened(courseId, relPath)
    return
  }
  // Files without a dedicated tab kind are handed off to Finder.
  void invoke('materials:reveal', { courseId, relPath })
    .then(() => recordMaterialOpened(courseId, relPath))
    .catch((error: unknown) => {
      console.error('[Bandal] 파일을 Finder에서 열지 못했습니다.', error)
      showToast('파일을 Finder에서 열지 못했습니다.', 'danger')
    })
}
