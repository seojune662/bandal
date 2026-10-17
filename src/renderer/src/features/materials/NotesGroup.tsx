import { migrateCourseNotes } from '../pdfNotes/legacyMigration'
import { useMaterialsStore } from '../../stores/materialsStore'
import { useEffect } from 'react'
import type { MaterialNode } from '../../../../shared/types/materials'
import { showToast } from '../../app/toast'

export const NOTES_FOLDER = '노트'
/** Notes are the PDFs in the course's `노트/` folder, newest first. They are
 * ordinary files in the sidebar tree; this list only feeds clip delivery. */
export function noteNodes(tree: MaterialNode[]): MaterialNode[] {
  const folder = tree.find(node => node.kind === 'dir' && node.name === NOTES_FOLDER)
  return [...(folder?.children ?? [])].filter(node => node.kind === 'pdf').sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
}

/** Converts legacy whiteboards into PDF notes once per course visit. A result
 * that lands after the course changed never refreshes or warns the new one. */
export function useLegacyNoteMigration(courseId: string | null): void {
  useEffect(() => {
    if (courseId === null) return
    let active = true
    void migrateCourseNotes(courseId).then(result => {
      if (!active) return
      if (result.failed.length) showToast(result.failed.map(item => item.message).join(' · '), 'danger')
      if (result.migrated.length) void useMaterialsStore.getState().loadTree(courseId, { refreshOnly: true })
    }).catch(error => {
      if (active) showToast(error instanceof Error ? error.message : '기존 노트 이전을 완료하지 못했습니다. 원본은 보존되어 있습니다.', 'danger')
    })
    return () => { active = false }
  }, [courseId])
}
