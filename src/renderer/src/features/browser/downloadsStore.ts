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
  /** What main is currently filing downloads under. */
  targetCourseId: string | null
  followPage: (url: string, fallbackCourseId: string | null) => Promise<void>
  init: () => void
  /** Tells main where completed downloads should be filed. */
  setTargetCourse: (courseId: string | null) => Promise<void>
  dismiss: (id: string) => void
}

let initialized = false
const downloadFolderNotices = new Set<string>()

export const useDownloads = create<DownloadsState>()((set, get) => ({
  downloads: [],
  activeCount: 0,
  targetCourseId: null,

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

      if (update.state === 'completed' || update.state === 'interrupted') {
        downloadFolderNotices.delete(update.id)
      }

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
        if (!downloadFolderNotices.has(update.id)) {
          downloadFolderNotices.add(update.id)
          showToast(`${update.fileName}은(는) 다운로드 폴더에 저장됩니다.`)
        }
      }
    })
  },

  setTargetCourse: async (courseId) => {
    set({ targetCourseId: courseId })
    await invoke('browser:setDownloadTarget', { courseId })
  },

  /**
   * Files downloads under the course the OPEN PAGE is about, when the page is
   * a recognised LMS course. A student on 자료구조's LMS page means the handout
   * to go to 자료구조, whatever the sidebar happens to have selected.
   * Falls back to the selected course when nothing matches — never guesses.
   */
  followPage: async (url, fallbackCourseId) => {
    let courseId = fallbackCourseId
    try {
      const matched = await invoke('browser:courseForUrl', { url })
      if (matched.courseId !== null) courseId = matched.courseId
    } catch {
      // Matching is an optimisation; the fallback is always correct-ish.
    }
    if (courseId === get().targetCourseId) return
    set({ targetCourseId: courseId })
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
