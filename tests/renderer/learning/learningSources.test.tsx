// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { LearningSources } from '../../../src/renderer/src/features/learning/LearningSources'
import { takePdfPageNavigation } from '../../../src/renderer/src/features/pdf/pdfPageNavigation'
const { invoke, openMaterialInCourse } = vi.hoisted(() => ({ invoke: vi.fn(), openMaterialInCourse: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
vi.mock('../../../src/renderer/src/features/workspace/openMaterial', () => ({ openMaterialInCourse }))
vi.mock('../../../src/renderer/src/app/tabCommands', () => ({ createBrowserTab: vi.fn() }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('a PDF citation opens the original course at the cited page, including cold viewers', async () => {
  invoke.mockResolvedValue({ relPath: 'lectures/lesson.pdf', sourceCourseId: 'source-course', missing: false })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<LearningSources binding={{ courseId: 'study-space', rootRelPath: '' }} sources={[{ kind: 'material', relPath: 'lesson.pdf', quote: 'evidence', page: 7, sourceCourseId: 'source-course', pathScope: 'course' }]} onArticle={() => {}} />))
    await act(async () => host.querySelector('button')!.click())
    expect(openMaterialInCourse).toHaveBeenCalledWith('source-course', 'pdf', 'lectures/lesson.pdf')
    expect(takePdfPageNavigation('source-course', 'lectures/lesson.pdf')).toBe(7)
    expect(takePdfPageNavigation('study-space', 'lectures/lesson.pdf')).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})
