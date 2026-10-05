import { describe, expect, test } from 'vitest'
import { workspaceSyncPayload } from '../../../src/renderer/src/features/agent/workspaceSync'
import type { TabDescriptor } from '../../../src/shared/tabs'

function pdfTab(relPath: string): TabDescriptor {
  return {
    kind: 'pdf',
    payload: { courseId: 'ds', relPath }
  }
}

function noteTab(relPath: string): TabDescriptor {
  return {
    kind: 'note',
    payload: { courseId: 'ds', relPath }
  }
}

function browserTab(tabId: string): TabDescriptor {
  return {
    kind: 'browser',
    payload: { tabId, initialUrl: 'https://example.com/' }
  }
}

describe('workspaceSyncPayload', () => {
  test('global home explicitly clears previously selected course, document and selection context, even during pending hydration', () => {
    expect(workspaceSyncPayload({ surface: 'learning-home', openTabs: { pdf: pdfTab('private.pdf') }, activeDescriptor: pdfTab('private.pdf'), selectedCourseId: 'ds', hydration: 'loading' }))
      .toEqual({ selectedCourseId: null, tabs: [], documents: [], selection: '' })
  })
  test('publishes nothing until workspace hydration is ready', () => {
    expect(
      workspaceSyncPayload({
        openTabs: { pdf: pdfTab('lecture.pdf') },
        activeDescriptor: null,
        selectedCourseId: 'ds',
        hydration: 'loading'
      })
    ).toBeNull()
  })

  test('excludes browser tabs', () => {
    const payload = workspaceSyncPayload({
      openTabs: {
        browser: browserTab('browser-1'),
        pdf: pdfTab('lecture.pdf')
      },
      activeDescriptor: null,
      selectedCourseId: 'ds',
      hydration: 'ready'
    })

    expect(payload?.tabs).toEqual([
      { kind: 'pdf', title: 'lecture.pdf', active: false, courseId: 'ds', documentId: 'pdf', relPath: 'lecture.pdf' }
    ])
  })

  test('marks only the active tab active', () => {
    const activeDescriptor = noteTab('week-1.md')
    const payload = workspaceSyncPayload({
      openTabs: {
        pdf: pdfTab('lecture.pdf'),
        note: noteTab('week-1.md')
      },
      activeDescriptor,
      selectedCourseId: 'ds',
      hydration: 'ready'
    })

    expect(payload?.tabs).toEqual([
      { kind: 'pdf', title: 'lecture.pdf', active: false, courseId: 'ds', documentId: 'pdf', relPath: 'lecture.pdf' },
      { kind: 'note', title: 'week-1', active: true, courseId: 'ds', documentId: 'note', relPath: 'week-1.md' }
    ])
    expect(payload?.tabs.filter((tab) => tab.active)).toHaveLength(1)
  })

  test('publishes an empty list when there are no tabs', () => {
    expect(
      workspaceSyncPayload({
        openTabs: {},
        activeDescriptor: null,
        selectedCourseId: null,
        hydration: 'ready'
      })
    ).toEqual({ selectedCourseId: null, tabs: [] })
  })
})
