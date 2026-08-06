/**
 * Glue for the materials sidebar: clicking a file opens it as a
 * workspace tab (pdf/md) or reveals it in Finder (images and everything
 * else — no dedicated tab kind). Kept here (not in the materials feature)
 * so the sidebar only needs a one-line call.
 */

import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import type { MaterialKind } from '../../../../shared/types/materials'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from './tabIdentity'

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
  if (kind === 'pdf' || kind === 'note') {
    useWorkspaceStore.getState().openTab(
      descriptorFor(kind, { courseId, relPath })
    )
    return
  }
  // Images and other files have no tab kind — hand off to Finder.
  void invoke('materials:reveal', { courseId, relPath }).catch(
    (error: unknown) => {
      console.error('[Bandal] 파일을 Finder에서 열지 못했습니다.', error)
      showToast('파일을 Finder에서 열지 못했습니다.', 'danger')
    }
  )
}
