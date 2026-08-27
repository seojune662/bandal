import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { StudyToolDefinition } from '../../../src/shared/types/study'
import {
  isPackFollowUpAvailable,
  StudyToolMenu
} from '../../../src/renderer/src/features/study/StudyToolMenu'
import { isStudyToolEnabled } from '../../../src/renderer/src/features/study/studyToolAvailability'
import {
  type PackStudyToolDefinition,
  useStudyToolsStore
} from '../../../src/renderer/src/features/study/studyToolsStore'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

const fileOnlyTool: StudyToolDefinition = {
  id: 'explain',
  label: '쉽게 설명',
  description: '선택한 파일을 쉽게 풀어 설명해요.',
  worksOnCourse: false
}

const installedPack: PackStudyToolDefinition = {
  id: 'custom:vocab-chain',
  label: '나의 단어 사슬',
  description: '기사에서 단어를 모아요.',
  worksOnCourse: false,
  source: 'user',
  usesWeb: true,
  outputs: { dir: '영어 학습', primary: '단어 사슬 리포트' },
  followUp: {
    label: '이 기사로 이어가기',
    recipe: '다음 회차를 진행하라.'
  }
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

afterEach(() => setIpcAdapter(null))

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

  test('separates installed pack items and marks web-enabled packs', () => {
    const html = renderToStaticMarkup(
      <StudyToolMenu
        courseId="course-1"
        relPath="강의/1주차.pdf"
        x={0}
        y={0}
        onClose={() => undefined}
        toolsOverride={[installedPack]}
      />
    )

    expect(html).toContain('설치한 팩')
    expect(html).toContain('나의 단어 사슬')
    expect(html).toContain('aria-label="웹 검색 사용"')
  })

  test('shows a follow-up only for files below the pack output directory', () => {
    expect(isPackFollowUpAvailable(installedPack, '영어 학습/기사/새 기사.md'))
      .toBe(true)
    expect(isPackFollowUpAvailable(installedPack, '영어 학습자료/다른 결과.md'))
      .toBe(false)

    const inside = renderToStaticMarkup(
      <StudyToolMenu
        courseId="course-1"
        relPath="영어 학습/기사/새 기사.md"
        x={0}
        y={0}
        onClose={() => undefined}
        toolsOverride={[installedPack]}
      />
    )
    const outside = renderToStaticMarkup(
      <StudyToolMenu
        courseId="course-1"
        relPath="다른 폴더/새 기사.md"
        x={0}
        y={0}
        onClose={() => undefined}
        toolsOverride={[installedPack]}
      />
    )

    expect(inside).toContain('이 기사로 이어가기')
    expect(outside).not.toContain('이 기사로 이어가기')
  })

  test('passes the originating pack id as followUpOf to study:run', async () => {
    const invokeMock = vi.fn(async () => ({ relPath: '영어 학습/다음.md' }))
    setIpcAdapter({
      invoke: invokeMock,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await useStudyToolsStore.getState().run({
      courseId: 'course-1',
      tool: installedPack.id,
      relPath: '영어 학습/기사/새 기사.md',
      followUpOf: installedPack.id
    })

    expect(invokeMock).toHaveBeenCalledWith('study:run', {
      courseId: 'course-1',
      tool: installedPack.id,
      relPath: '영어 학습/기사/새 기사.md',
      followUpOf: installedPack.id
    })
  })
})
