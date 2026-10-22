import { expect, test } from 'vitest'
import { projectBindingKey } from '../../../src/shared/projectNavigation'
import { initializeProjectNavigation, moveProject } from '../../../src/renderer/src/features/learning/projectNavigationModel'
import type { LearningProjectSummary } from '../../../src/shared/types/learning'
const project = (rootRelPath: string, purpose: 'english-reading' | 'course-review', updatedAt: string): LearningProjectSummary => ({ binding: { courseId: 'course', rootRelPath }, projectId: 'copied-id', name: rootRelPath, purpose, updatedAt, topic: '', level: 'beginner', readingMinutes: 10, articleCount: 0, completedArticleCount: 0, wordCount: 0, knownWordCount: 0, dueCardCount: 0, warning: null })
test('migrates old purpose groups once and allows independent manual membership for copied IDs', () => {
  const a = project('A', 'english-reading', '2026-01-02'), b = project('B', 'course-review', '2026-01-01')
  const initial = initializeProjectNavigation([b, a])
  expect(initial.entries.map(entry => entry.rootRelPath)).toEqual(['A', 'B'])
  const next = moveProject(initial, projectBindingKey(b.binding), initial.groups[0]!.id, projectBindingKey(a.binding))
  expect(next.entries.map(entry => entry.rootRelPath)).toEqual(['B', 'A'])
  expect(next.entries[0]!.groupId).toBe(next.entries[1]!.groupId)
  expect(initial.entries[0]!.rootRelPath).toBe('A')
})
