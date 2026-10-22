import { expect, test } from 'vitest'
import { selectChatContextMaterial } from '../../../src/main/features/agent/chatContextSelection'
const original = { courseId: 'course-a', kind: 'note', title: 'Source', relPath: 'source.md', documentId: 'panel-a' }
const panels = new Map([['panel-a', original]])
const last = new Map([['course-a', original]])
test('an empty project source never inherits the last document from a sibling workspace', () => {
  expect(selectChatContextMaterial('course-a', '', true, panels, last)).toBeUndefined()
  expect(selectChatContextMaterial('course-a', undefined, true, panels, last)).toEqual(original)
})
test('an explicit current panel keeps its source owner in a separate project conversation', () => {
  expect(selectChatContextMaterial('project-b', 'panel-a', true, panels, last)).toEqual(original)
  expect(selectChatContextMaterial('project-b', 'panel-a', false, panels, last)).toBeUndefined()
  expect(selectChatContextMaterial('course-a', 'closed-panel', true, panels, last)).toBeUndefined()
})
