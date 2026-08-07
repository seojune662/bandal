import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RunStudyToolInput, StudyToolId } from '../../../src/shared/types/study'
import { PathTraversalError, ValidationError } from '../../../src/main/db/errors'
import { createStudyRunner } from '../../../src/main/features/study/studyRunner'

const COURSE_ID = 'course-1'
const ALL_TOOL_IDS: StudyToolId[] = [
  'summary',
  'quiz',
  'flashcards',
  'mindmap',
  'structured-notes',
  'exam-predictions',
  'explain'
]

describe('studyRunner', () => {
  let testDir: string
  let courseFolder: string

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 7, 12, 0, 0))
    testDir = mkdtempSync(join(tmpdir(), 'bandal-study-'))
    courseFolder = join(testDir, 'course')
    mkdirSync(courseFolder, { recursive: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(testDir, { recursive: true, force: true })
  })

  test('dispatches all seven prompts with their planned output paths', async () => {
    const calls: Array<{ courseId: string; prompt: string }> = []
    const runner = createStudyRunner({
      getCourse: () => ({ name: '운영체제', folder: courseFolder }),
      ask: async (courseId, prompt) => {
        calls.push({ courseId, prompt })
      }
    })

    for (const tool of ALL_TOOL_IDS) {
      const input: RunStudyToolInput = {
        courseId: COURSE_ID,
        tool,
        relPath: '강의자료/Chap1.pdf'
      }
      const result = await runner.run(input)
      const call = calls.at(-1)

      expect(result.relPath).toMatch(/^AI 학습자료\/.+ - Chap1 2026-08-07\.md$/)
      expect(call?.courseId).toBe(COURSE_ID)
      expect(call?.prompt).toContain(`./${result.relPath}`)
      expect(call?.prompt).toContain('Write 도구의 파일 경로')
    }
    expect(calls).toHaveLength(7)
  })

  test('adds -2 when the planned file name already exists', async () => {
    const outputDirectory = join(courseFolder, 'AI 학습자료')
    mkdirSync(outputDirectory, { recursive: true })
    writeFileSync(join(outputDirectory, '퀴즈 - Chap1 2026-08-07.md'), '# existing\n')
    let capturedPrompt = ''
    const runner = createStudyRunner({
      getCourse: () => ({ name: '운영체제', folder: courseFolder }),
      ask: async (_courseId, prompt) => {
        capturedPrompt = prompt
      }
    })

    const result = await runner.run({
      courseId: COURSE_ID,
      tool: 'quiz',
      relPath: 'Chap1.pdf'
    })

    expect(result.relPath).toBe('AI 학습자료/퀴즈 - Chap1 2026-08-07-2.md')
    expect(capturedPrompt).toContain('./AI 학습자료/퀴즈 - Chap1 2026-08-07-2.md')
  })

  test('reserves a dispatched path while the agent is still writing it', async () => {
    const runner = createStudyRunner({
      getCourse: () => ({ name: '운영체제', folder: courseFolder }),
      // Dispatch completes before the streamed Write necessarily happens.
      ask: async () => undefined
    })

    const first = await runner.run({
      courseId: COURSE_ID,
      tool: 'summary',
      relPath: 'Chap1.pdf'
    })
    const second = await runner.run({
      courseId: COURSE_ID,
      tool: 'summary',
      relPath: 'Chap1.pdf'
    })

    expect(first.relPath).toBe('AI 학습자료/요약 - Chap1 2026-08-07.md')
    expect(second.relPath).toBe('AI 학습자료/요약 - Chap1 2026-08-07-2.md')
  })

  test('rejects a target path that escapes the course folder', async () => {
    const ask = vi.fn(async () => undefined)
    const runner = createStudyRunner({
      getCourse: () => ({ name: '운영체제', folder: courseFolder }),
      ask
    })

    await expect(
      runner.run({ courseId: COURSE_ID, tool: 'summary', relPath: '../outside.pdf' })
    ).rejects.toThrow(PathTraversalError)
    expect(ask).not.toHaveBeenCalled()
  })

  test('rejects course-wide use for a tool with worksOnCourse false', async () => {
    const ask = vi.fn(async () => undefined)
    const runner = createStudyRunner({
      getCourse: () => ({ name: '운영체제', folder: courseFolder }),
      ask
    })

    expect(runner.tools().find((tool) => tool.id === 'explain')?.worksOnCourse).toBe(false)
    await expect(
      runner.run({ courseId: COURSE_ID, tool: 'explain', relPath: null })
    ).rejects.toThrow(ValidationError)
    expect(ask).not.toHaveBeenCalled()
  })
})
