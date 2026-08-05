/**
 * Glue for the materials sidebar: double-clicking a file opens it as a
 * workspace tab. Kept here (not in the materials feature) so the sidebar
 * only needs a one-line call.
 */

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

  if (kind === 'pdf') {
    useWorkspaceStore.getState().openTab(
      descriptorFor('pdf', { courseId, relPath })
    )
  } else if (kind === 'note') {
    useWorkspaceStore.getState().openTab(
      descriptorFor('note', { courseId, relPath })
    )
  } else {
    // Images and other files have no tab kind yet (post-M2).
    console.info('[Bandal] 이 파일 형식은 아직 탭으로 열 수 없습니다:', relPath)
  }
}
