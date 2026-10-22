import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createChatRepo, type ChatRepo } from '../../../src/main/features/agent/chatRepo'
import { validateStudyConversation, recordStudyConversation } from '../../../src/main/features/agent/chatStudyRecords'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { workspaceKey } from '../../../src/shared/types/workspace'
let ctx: TestDb, repo: ChatRepo
const courseId = 'course-1', projectKey = workspaceKey({ kind: 'project', courseId, rootRelPath: 'Nested' })
beforeEach(() => {
  ctx = createTestDb(); repo = createChatRepo(ctx.db)
  const now = new Date().toISOString()
  ctx.db.prepare('INSERT INTO courses (id,name,slug,color,folder_path,archived,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,0,0,?,?)').run(courseId, 'Course', courseId, '#000', '/tmp/course-1', now, now)
})
afterEach(() => ctx.cleanup())
test('persists the user request and native result reference in its exact project conversation', () => {
  const request = { sessionId: 'chat-project', workspaceKey: projectKey, content: '5문제로 만들어줘', context: { files: [{ name: 'source', relPath: 'Nested/source.md' }] } }
  validateStudyConversation(repo, courseId, request)
  const emit = vi.fn()
  recordStudyConversation(repo, courseId, request, { courseId, relPath: 'Nested', name: '퀴즈', kind: 'other', learning: { binding: { courseId, rootRelPath: 'Nested' }, runId: 'run-1' } }, 'codex', emit)
  expect(emit).toHaveBeenCalledTimes(2)
  expect(repo.workspaceForSession(request.sessionId)).toBe(projectKey)
  expect(repo.listConversations(courseId, 'app', projectKey).map(item => item.id)).toEqual(['chat-project'])
  expect(repo.listConversations(courseId, 'app', courseId)).toEqual([])
  expect(repo.historyTail('chat-project').map(message => message.blocks[0]?.payload)).toMatchObject([{ text: request.content, context: { workspaceKey: projectKey } }, { learning: { runId: 'run-1' } }])
  expect(() => validateStudyConversation(repo, courseId, { ...request, workspaceKey: courseId })).toThrow('다른 공간')
})
test('course history retains old unassigned conversations but excludes projects', () => {
  repo.createSession('legacy', courseId, 'codex'); repo.appendMessage(courseId, 'legacy', 'user', 1, [{ kind: 'text', payload: { text: 'old' } }])
  expect(repo.listConversations(courseId, 'app', courseId).map(item => item.id)).toEqual(['legacy'])
  expect(repo.listConversations(courseId, 'app', projectKey)).toEqual([])
})
test('rejects busy conversations and malformed annotation snapshots before generating', () => {
  repo.createSession('busy', courseId, 'codex'); repo.setStatus('busy', 'running')
  expect(() => validateStudyConversation(repo, courseId, { sessionId: 'busy', workspaceKey: projectKey, content: 'generate' })).toThrow('응답')
  expect(() => validateStudyConversation(repo, courseId, { sessionId: 'new', workspaceKey: projectKey, content: 'generate', context: { references: [{} as never] } })).toThrow('위치')
})
