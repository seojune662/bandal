import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'

vi.mock('../../../src/renderer/src/i18n', () => ({
  LOCALES: ['ko-KR', 'en-US'],
  setLocale: vi.fn(),
  useLocale: () => 'ko-KR',
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      'settings.courses.archived': '보관됨',
      'settings.courses.showArchived': '보관된 과목 표시',
      'settings.courses.showArchivedHelp': '보관 처리한 과목도 표시합니다.'
    }
    return messages[key] ?? key
  }
}))

import { ArchiveCourseDialog } from '../../../src/renderer/src/features/courses/CourseDialogs'
import { CoursesPanel } from '../../../src/renderer/src/features/settings/SettingsPanels'

const archivedCourse: Course = {
  id: 'course-1',
  name: '자료구조',
  slug: 'data-structures',
  color: 'gold',
  folderPath: '/courses/data-structures',
  source: 'managed',
  missing: false,
  archived: true,
  groupId: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('course archive UI', () => {
  test('offers restore beside an archived course in Settings', () => {
    const html = renderToStaticMarkup(
      <CoursesPanel
        courses={[archivedCourse]}
        loading={false}
        error={null}
        includeArchived={true}
        pendingCourseId={null}
        onIncludeArchivedChange={vi.fn()}
        onRestore={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(html).toContain('보관됨')
    expect(html).toContain('aria-label="자료구조 복원"')
    expect(html).toContain('>복원</button>')
  })

  test('shows a pending state while the course is being restored', () => {
    const html = renderToStaticMarkup(
      <CoursesPanel
        courses={[archivedCourse]}
        loading={false}
        error={null}
        includeArchived={true}
        pendingCourseId={archivedCourse.id}
        onIncludeArchivedChange={vi.fn()}
        onRestore={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(html).toContain('복원 중…')
    expect(html).toContain('disabled=""')
  })

  test('explains that archiving can be reversed from Settings', () => {
    const html = renderToStaticMarkup(
      <ArchiveCourseDialog
        courseName={archivedCourse.name}
        pending={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn(async () => {})}
      />
    )

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('과목을 보관할까요?')
    expect(html).toContain('나중에 설정에서 복원할 수 있어요.')
  })
})
