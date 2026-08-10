import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { MaterialBacklinks } from '../../../src/shared/types/link'
import {
  backlinkPageLabel,
  MaterialBacklinksSection
} from '../../../src/renderer/src/features/pdf/AnnotationRail'

function renderBacklinks(backlinks: MaterialBacklinks): string {
  return renderToStaticMarkup(
    <MaterialBacklinksSection
      backlinks={backlinks}
      onOpenNote={vi.fn()}
      onOpenBoard={vi.fn()}
    />
  )
}

describe('PDF material backlinks', () => {
  test('does not render an empty backlinks section', () => {
    const html = renderBacklinks({ notes: [], boards: [] })

    expect(html).toBe('')
    expect(html).not.toContain('이 자료를 인용한 곳')
  })

  test('renders note and whiteboard labels with cited pages', () => {
    const html = renderBacklinks({
      notes: [{ ref: '중간고사/요약.md', label: '중간고사 요약', page: 12 }],
      boards: [{ ref: 'board-1', label: '시험 범위', page: 3 }]
    })

    expect(html).toContain('이 자료를 인용한 곳')
    expect(html).toContain('필기')
    expect(html).toContain('중간고사 요약')
    expect(html).toContain('12쪽')
    expect(html).toContain('화이트보드')
    expect(html).toContain('시험 범위')
    expect(html).toContain('3쪽')
  })

  test('formats only page-specific backlinks', () => {
    expect(backlinkPageLabel(12)).toBe('12쪽')
    expect(backlinkPageLabel(null)).toBeNull()
  })
})
