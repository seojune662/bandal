import type { ChatRepo } from './chatRepo'
import type { AgentProvider } from '../../../shared/types/agent-events'
import type { ChatMessage } from '../../../shared/types/chat'
import type { ChatArtifact, StudyConversationRequest } from '../../../shared/types/chatCapabilities'
import { workspaceFromKey } from '../../../shared/types/workspace'
import { sanitizeAnnotationReferences } from '../../../shared/types/chatAnnotation'

export function validateStudyConversation(repo: ChatRepo, courseId: string, request: StudyConversationRequest): void {
  if (!request.sessionId || request.content.length > 20_000 || workspaceFromKey(request.workspaceKey).courseId !== courseId) throw new Error('대화의 공간과 요청을 확인해 주세요.')
  const session = repo.getSession(request.sessionId)
  if (session && (session.courseId !== courseId || session.status === 'running')) throw new Error('대화의 진행 중인 응답이 끝난 뒤 실행하세요.')
  const owner = repo.workspaceForSession(request.sessionId)
  if (owner && owner !== request.workspaceKey) throw new Error('다른 공간의 대화에 학습 결과를 추가할 수 없어요.')
  if (request.context) {
    delete request.context.displayContent
    delete request.context.outputDir
    request.context.references = sanitizeAnnotationReferences(request.context.references ?? [])
    if (request.context.files && (!Array.isArray(request.context.files) || request.context.files.length > 20 || request.context.files.some(file => !file || typeof file.relPath !== 'string' || typeof file.name !== 'string'))) throw new Error('첨부한 자료 목록을 확인해 주세요.')
  }
}
export function recordStudyConversation(repo: ChatRepo, courseId: string, request: StudyConversationRequest, artifact: ChatArtifact, provider: AgentProvider, emit: (message: ChatMessage) => void, includeUser = true): void {
  if (!repo.getSession(request.sessionId)) repo.createSession(request.sessionId, courseId, provider)
  repo.bindWorkspace(request.sessionId, request.workspaceKey)
  const turnSeq = repo.nextTurnSeq(request.sessionId)
  if (includeUser) emit(repo.appendMessage(courseId, request.sessionId, 'user', turnSeq, [{ kind: 'text', payload: { text: request.content, context: { ...request.context, workspaceKey: request.workspaceKey } } }]))
  emit(repo.appendMessage(courseId, request.sessionId, 'assistant', turnSeq, [{ kind: 'artifact', payload: artifact }]))
  repo.setTitleIfEmpty(request.sessionId, request.content.trim() || artifact.name)
}
