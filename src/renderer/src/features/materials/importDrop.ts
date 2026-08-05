/**
 * [M5] Finder drag & drop import, shared by the materials sidebar and the
 * workspace watermark. Resolves dropped Files to absolute paths through the
 * preload bridge (webUtils.getPathForFile), runs `materials:import` and
 * reports the outcome as toasts. The folder watcher refreshes the tree, but
 * an immediate silent reload keeps the UI snappy.
 */

import { showToast } from '../../app/toast'
import { invoke, pathForFile } from '../../lib/ipc'
import { useMaterialsStore } from '../../stores/materialsStore'

/** True when the drag payload contains OS files (vs. in-app HTML5 dnd). */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && [...dataTransfer.types].includes('Files')
}

function fileName(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] ?? path
}

export async function importDroppedFiles(
  courseId: string,
  files: readonly File[]
): Promise<void> {
  const paths = files.map(pathForFile).filter((path) => path.length > 0)
  if (paths.length === 0) {
    showToast('가져올 수 있는 파일이 없어요', 'danger')
    return
  }

  try {
    const result = await invoke('materials:import', { courseId, paths })
    if (result.imported.length > 0) {
      showToast(`${result.imported.length}개 가져옴`)
      void useMaterialsStore.getState().loadTree(courseId, { silent: true })
    }
    if (result.failed.length > 0) {
      const names = result.failed.map((entry) => fileName(entry.path)).join(', ')
      showToast(`${result.failed.length}개 실패: ${names}`, 'danger')
    }
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : '파일을 가져오지 못했습니다.',
      'danger'
    )
  }
}
