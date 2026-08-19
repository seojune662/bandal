/**
 * [M5] Finder drag & drop import, shared by the materials sidebar and the
 * workspace watermark. Resolves dropped Files to absolute paths through the
 * preload bridge (webUtils.getPathForFile), runs `materials:import` and
 * reports the outcome as toasts. The folder watcher refreshes the tree, but
 * an immediate silent reload keeps the UI snappy.
 */

import { showToast } from '../../app/toast'
import { invoke, pathForFile } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { useMaterialsStore } from '../../stores/materialsStore'

/** True when the drag payload contains OS files (vs. in-app HTML5 dnd). */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && [...dataTransfer.types].includes('Files')
}

function fileName(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] ?? path
}

export async function importMaterialPaths(
  courseId: string,
  paths: readonly string[],
  dirRelPath?: string
): Promise<string[]> {
  if (paths.length === 0) {
    showToast('가져올 수 있는 파일이 없어요', 'danger')
    return []
  }

  try {
    const result = await invoke('materials:import', {
      courseId,
      paths: [...paths],
      // '' 또는 생략 = 과목 폴더 루트. 폴더 위에 드롭하면 그 폴더로 들어간다.
      ...(dirRelPath !== undefined && dirRelPath !== '' ? { dirRelPath } : {})
    })
    if (result.imported.length > 0) {
      showToast(`${result.imported.length}개 가져옴`)
      await useMaterialsStore.getState().loadTree(courseId, { silent: true })
    }
    if (result.failed.length > 0) {
      const names = result.failed.map((entry) => fileName(entry.path)).join(', ')
      showToast(`${result.failed.length}개 실패: ${names}`, 'danger')
    }
    return result.imported
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : '파일을 가져오지 못했습니다.',
      'danger'
    )
    return []
  }
}

/** 과목 폴더 안의 절대 경로를 posix relPath 로 바꾼다. 밖이면 null. */
export function relPathInsideCourse(
  absPath: string,
  courseFolder: string
): string | null {
  const normalized = absPath.replace(/\\/gu, '/')
  const folder = courseFolder.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (!normalized.startsWith(`${folder}/`)) return null
  return normalized.slice(folder.length + 1)
}

export async function importDroppedFiles(
  courseId: string,
  files: readonly File[],
  dirRelPath?: string
): Promise<string[]> {
  const paths = files.map(pathForFile).filter((path) => path.length > 0)

  // 자료 행의 네이티브 드래그가 우리 패널로 돌아온 경우: 경로가 이 과목
  // 폴더 안이면 복사(가져오기)가 아니라 이동이다. Finder 파일만 가져온다.
  const courseFolder = useCoursesStore
    .getState()
    .courses.find((course) => course.id === courseId)?.folderPath
  const toImport: string[] = []
  const toMove: string[] = []
  for (const path of paths) {
    const rel =
      courseFolder === undefined
        ? null
        : relPathInsideCourse(path, courseFolder)
    if (rel === null) toImport.push(path)
    else toMove.push(rel)
  }

  const moved: string[] = []
  for (const fromRelPath of toMove) {
    try {
      const { relPath } = await invoke('materials:move', {
        courseId,
        fromRelPath,
        toDirRelPath: dirRelPath ?? ''
      })
      moved.push(relPath)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '이동하지 못했습니다.',
        'danger'
      )
    }
  }
  if (moved.length > 0) {
    showToast(moved.length === 1 ? '이동했어요.' : `${moved.length}개 이동했어요.`)
    await useMaterialsStore.getState().loadTree(courseId, { silent: true })
  }

  if (toImport.length === 0) return moved
  const imported = await importMaterialPaths(courseId, toImport, dirRelPath)
  return [...moved, ...imported]
}
