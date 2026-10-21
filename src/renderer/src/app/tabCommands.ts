/**
 * Tab-creating commands shared by the ⌘-shortcuts and the new-tab omnibox.
 *
 * These live outside the workspace feature so both callers reach the same
 * implementation: a shortcut that opened a *slightly different* markdown tab
 * than the menu would be a silent divergence nobody notices until it bites.
 */

import { v4 as uuidv4 } from 'uuid'
import { openNewNoteSheet } from '../features/pdfNotes/NewNoteSheet'
import type { TabDescriptor } from '../../../shared/tabs'
import { invoke } from '../lib/ipc'
import { useCoursesStore } from '../stores/coursesStore'
import { useMaterialsStore } from '../stores/materialsStore'
import { settingsSnapshot } from '../stores/settingsSnapshot'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { descriptorFor } from '../features/workspace/tabIdentity'
import { showToast } from './toast'
import type { WorkspaceTarget } from '../features/workspace/placementContext'

export const DEFAULT_BROWSER_URL = 'https://www.google.com'

/** `새 마크다운 2026-08-07 00.54` — stable, sortable, collision-resistant. */
export function defaultMarkdownTitle(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}`
  return `${settingsSnapshot().tabs.markdownTitlePrefix} ${date} ${time}`
}

function activeCourseId(): string | null {
  if (useWorkspaceStore.getState().surface !== 'course') return null
  return useCoursesStore.getState().selectedCourseId
}

/** Creates a .md in the course root and opens it. No-op without a course. */
export async function createMarkdownTab(title?: string, target?: WorkspaceTarget): Promise<void> {
  const courseId = target ? target.courseId : activeCourseId()
  if (courseId === null) return
  try {
    const ref = await invoke('notes:create', {
      courseId,
      dirRelPath: '',
      title: title ?? defaultMarkdownTitle(new Date())
    })
    if (target) useWorkspaceStore.getState().openTab(descriptorFor('note', ref), { target })
    else if (activeCourseId() === courseId) useWorkspaceStore.getState().openTab(descriptorFor('note', ref))
    else showToast('원래 과목에 새 필기를 만들었어요.')
    void useMaterialsStore.getState().loadTree(courseId, { refreshOnly: true })
  } catch (error) {
    console.error('[Bandal] 마크다운을 만들지 못했습니다.', error)
    showToast('필기를 만들지 못했어요. 다시 시도해 주세요.', 'danger')
  }
}

/** The keyboard picker creates a note immediately using the saved paper defaults. */
export async function createDefaultNoteTab(target?: WorkspaceTarget): Promise<void> {
  const courseId = target ? target.courseId : activeCourseId()
  if (courseId === null) return
  const now = new Date()
  const title = `노트 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const { notePaper: paper, noteOrientation: orientation } = settingsSnapshot().tabs
  try {
    const { relPath } = await invoke('pdfNotes:create', { courseId, title, paper, orientation })
    const descriptor = descriptorFor('pdf', { courseId, relPath })
    if (target) useWorkspaceStore.getState().openTab(descriptor, { target })
    else if (activeCourseId() === courseId) useWorkspaceStore.getState().openTab(descriptor)
    else showToast('원래 과목에 새 노트를 만들었어요.')
    void useMaterialsStore.getState().loadTree(courseId, { refreshOnly: true })
  } catch (error) {
    console.error('[Bandal] 노트를 만들지 못했습니다.', error)
    showToast('노트를 만들지 못했어요. 다시 시도해 주세요.', 'danger')
  }
}

export function createBrowserTab(url?: string, target?: WorkspaceTarget): void {
  const homePage = settingsSnapshot().browser.homePage
  const initialUrl = url ?? (homePage !== '' ? homePage : DEFAULT_BROWSER_URL)
  useWorkspaceStore
    .getState()
    .openTab(descriptorFor('browser', { tabId: uuidv4(), initialUrl }), target ? { target } : undefined)
}

export async function createStudyTab(
  kind: 'chat' | 'recording' | 'whiteboard' | 'board',
  target?: WorkspaceTarget
): Promise<void> {
  const courseId = target ? target.courseId : activeCourseId()
  const open = (descriptor: TabDescriptor): void => {
    if (target) useWorkspaceStore.getState().openTab(descriptor, { target })
    else useWorkspaceStore.getState().openTab(descriptor)
  }
  if (kind === 'board') {
    open(descriptorFor('board', {}))
    return
  }
  if (courseId === null) return
  if (kind === 'chat') {
    open(descriptorFor('chat', { courseId, conversationId: uuidv4() }))
  } else if (kind === 'recording') {
    open(descriptorFor('recording', { courseId }))
  } else {
    openNewNoteSheet(courseId, target)
  }
}
