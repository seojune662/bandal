import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test } from 'vitest'
import type { StudyToolDefinition } from '../../../src/shared/types/study'
import { StudyToolMenu } from '../../../src/renderer/src/features/study/StudyToolMenu'
import { isStudyToolEnabled } from '../../../src/renderer/src/features/study/studyToolAvailability'
import { useStudyToolsStore } from '../../../src/renderer/src/features/study/studyToolsStore'

const fileOnlyTool: StudyToolDefinition = {
  id: 'explain',
  label: '쉽게 설명',
  description: '선택한 파일을 쉽게 풀어 설명해요.',
  worksOnCourse: false
}

beforeEach(() => {
  useStudyToolsStore.setState({
    tools: [],
    hasLoaded: true,
    isLoading: false,
    error: null,
    running: {},
    runError: null
  })
})

describe('study tool availability', () => {
  test('disables a file-only tool for a whole-course target', () => {
    expect(isStudyToolEnabled(fileOnlyTool, null)).toBe(false)
    expect(isStudyToolEnabled(fileOnlyTool, 'lecture-01.pdf')).toBe(true)
  })
})

describe('StudyToolMenu', () => {
  test('renders a stable empty state when no tools are available', () => {
    const html = renderToStaticMarkup(
      <StudyToolMenu
        courseId="course-1"
        relPath={null}
        x={0}
        y={0}
        onClose={() => undefined}
      />
    )

    expect(html).toContain('role="menu"')
    expect(html).toContain('AI 학습 도구를 불러오는 중이에요.')
    expect(html).not.toContain('role="menuitem"')
  })
})
