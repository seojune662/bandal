/**
 * Browser downloads, as the renderer sees them.
 *
 * Main does the filing (see `main/features/browser/downloads.ts`); this store
 * only mirrors progress so the toolbar can show it, and tells main which
 * course to file under whenever the selection changes.
 */

import { create } from 'zustand'
import type { BrowserDownloadUpdate } from '../../../../shared/ipc/events'
import { invoke, onPush } from '../../lib/ipc'
import { showToast, showToastWithAction } from '../../app/toast'

/** Finished downloads linger this long so the student can click through. */
const RECENT_TTL_MS = 60_000

export interface BrowserDownload extends BrowserDownloadUpdate {
  finishedAt: number | null
}

interface DownloadsState {
  /** Newest first. */
  downloads: BrowserDownload[]
  activeCount: number
  init: () => void
  /** Tells main where completed downloads should be filed. */
  setTargetCourse: (courseId: string | null) => Promise<void>
  dismiss: (id: string) => void
}

let initialized = false

export const useDownloads = create<DownloadsState>()((set, get) => ({
  downloads: [],
  activeCount: 0,

  init: () => {
    if (initialized) return
    initialized = true
    onPush('browser:download', (update) => {
      const previous = get().downloads
      const finished = update.state !== 'progressing'
      const next: BrowserDownload = {
        ...update,
        finishedAt: finished ? Date.now() : null
      }
      const merged = [
        next,
        ...previous.filter(
          (item) =>
            item.id !== update.id &&
            // Drop stale finished rows rather than growing forever.
            (item.finishedAt === null ||
              Date.now() - item.finishedAt < RECENT_TTL_MS)
        )
      ]
      set({
        downloads: merged,
        activeCount: merged.filter((item) => item.state === 'progressing')
          .length
      })

      if (update.state === 'completed' && update.relPath !== null) {
        showToastWithAction(`${update.fileName}을(를) 자료에 저장했어요.`, {
          label: '자료에서 보기',
          run: () => {
            if (update.courseId === null || update.relPath === null) return
            void invoke('materials:reveal', {
              courseId: update.courseId,
              relPath: update.relPath
            })
          }
        })
      } else if (update.state === 'interrupted') {
        showToast(
          update.failureReason === null
            ? `${update.fileName}을(를) 받지 못했어요.`
            : `${update.fileName}을(를) 저장하지 못했어요.`,
          'danger'
        )
      } else if (update.state === 'progressing' && update.courseId === null) {
        // Never silently drop it: say where it went instead.
        showToast(`${update.fileName}은(는) 다운로드 폴더에 저장됩니다.`)
      }
    })
  },

  setTargetCourse: async (courseId) => {
    await invoke('browser:setDownloadTarget', { courseId })
  },

  dismiss: (id) => {
    const remaining = get().downloads.filter((item) => item.id !== id)
    set({
      downloads: remaining,
      activeCount: remaining.filter((item) => item.state === 'progressing')
        .length
    })
  }
}))
