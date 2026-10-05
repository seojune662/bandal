import { expect, test } from 'vitest'
import type { Course } from '../../../src/shared/types/course'
import type { LearningProjectSummary, LearningRun } from '../../../src/shared/types/learning'
import { learningDisplayName, learningSourceCourse } from '../../../src/renderer/src/features/learning/learningPresentation'
import { visibleLearningRuns } from '../../../src/renderer/src/features/learning/learningRunPresentation'

const courses = [{ id: 'course', name: '선형대수학', workspaceKind: 'course' }, { id: 'study', name: 'AI 학습자료', workspaceKind: 'study-space' }] as Course[]
const legacy = { name: 'AI 학습자료', topic: '과목 자료', purpose: 'course-review', binding: { courseId: 'course', rootRelPath: 'AI 학습자료' } } as LearningProjectSummary

test('legacy automatic review names use the actual owner without changing paths or user names', () => {
  expect(learningDisplayName(legacy, courses)).toBe('선형대수학 복습')
  expect(learningDisplayName({ ...legacy, name: '시험 준비' }, courses)).toBe('시험 준비')
  expect(learningDisplayName({ ...legacy, topic: '내가 정한 주제' }, courses)).toBe('AI 학습자료')
  expect(legacy.binding.rootRelPath).toBe('AI 학습자료')
  const independent = { ...legacy, binding: { courseId: 'study', rootRelPath: '' }, linkedCourseId: 'course' }
  expect(learningDisplayName(independent, courses)).toBe('선형대수학 복습')
  expect(learningSourceCourse({ ...independent, linkedCourseId: 'deleted-course' }, courses)).toBeUndefined()
  expect(learningDisplayName({ ...independent, linkedCourseId: 'deleted-course' }, courses)).toBe('과목 복습')
})

const run = (id: string, status: LearningRun['status'], dismissedAt?: string): LearningRun => ({ id, status, ...(dismissedAt ? { dismissedAt } : {}) }) as LearningRun
test('past failures stay in history while active work and the newest unacknowledged failure stay actionable', () => {
  const historical = new Set(['old'])
  expect(visibleLearningRuns([run('old', 'failed'), run('cancel', 'cancelled')], historical)).toEqual([])
  expect(visibleLearningRuns([run('old', 'failed'), run('active', 'running'), run('fresh', 'failed')], historical).map(item => item.id)).toEqual(['active', 'fresh'])
  expect(visibleLearningRuns([run('fresh', 'failed', 'now')], historical)).toEqual([])
  expect(visibleLearningRuns([run('fresh', 'failed'), run('success', 'complete')], historical)).toEqual([])
})
