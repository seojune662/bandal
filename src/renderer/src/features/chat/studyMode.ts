import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { workspaceKey } from '../../../../shared/types/workspace'
import type { LearningAiSettings, LearningBinding } from '../../../../shared/types/learning'
import type { LearningGenerationSource } from '../../../../shared/ipc/learningContract'
import type { ChatContext } from '../../../../shared/types/chatCapabilities'
import type { AssistantMode } from '../assistantPanel/workspaceAssistantStore'
import { invoke } from '../../lib/ipc'
import { captureLauncherContext } from '../launcher/launcherContext'
import { flushOpenNoteSession } from '../notes/noteSessionRegistry'

export const ASSISTANT_MODES: { id: AssistantMode; label: string; placeholder: string }[] = [
  { id: 'chat', label: 'Chat', placeholder: '자료에 대해 무엇이든 물어보세요' },
  { id: 'quiz', label: '퀴즈', placeholder: '예: 핵심 개념으로 객관식 10문제를 만들어줘' },
  { id: 'flashcards', label: '플래시카드', placeholder: '예: 정의와 공식을 카드 15장으로 만들어줘' },
  { id: 'exam-predictions', label: '예상 문제', placeholder: '예: 서술형 예상 문제와 채점 기준을 만들어줘' }
]
export async function sendStudyMode(workspace: WorkspaceRef, conversationId: string, mode: Exclude<AssistantMode, 'chat'>, content: string, context: ChatContext, ai: LearningAiSettings): Promise<void> {
  const source = await captureLauncherContext()
  const original = source.descriptor
  const references = context.references ?? []
  if (source.sourceUnavailable && !context.files?.length && !references.length) throw new Error('원본 자료를 확인하지 못했어요. 원본을 다시 열거나 참조를 지정해 주세요.')
  const useCurrent = !source.sourceUnavailable && !context.excludeCurrentMaterial && !!source.courseId
  const explicitFileReference = references.find(ref => ref.relPath)
  const explicitFile = context.files?.[0]?.relPath ?? explicitFileReference?.relPath
  const explicitBrowser = references.find(ref => ref.url)
  if (context.excludeCurrentMaterial && !explicitFile && !explicitBrowser) throw new Error('현재 자료를 제외했어요. +에서 사용할 자료를 추가하거나 파일·웹 원본의 참조를 선택해 주세요.')
  const selectedFile = explicitFile ?? (useCurrent ? source.savedMaterialRelPath ?? source.material?.relPath : undefined)
  const sourceCourseId = context.files?.[0] ? workspace.courseId : explicitFileReference?.courseId ?? explicitBrowser?.courseId ?? (useCurrent ? source.courseId : null) ?? workspace.courseId
  const browser = explicitBrowser ? { url: explicitBrowser.url!, tabId: explicitBrowser.browserTabId } : useCurrent ? source.browser : null
  if (useCurrent && source.courseId === sourceCourseId && source.material?.kind === 'note' && source.material.relPath && source.material.relPath === selectedFile && source.courseId) {
    const saved = await flushOpenNoteSession({ courseId: source.courseId, relPath: source.material.relPath })
    if (saved && saved.result.status !== 'saved') throw new Error('필기를 저장하지 못했어요. 충돌을 해결한 뒤 다시 생성하세요.')
  }
  const conversation = { sessionId: conversationId, workspaceKey: workspaceKey(workspace), content, context }
  if (mode === 'exam-predictions') {
    await invoke('study:run', { courseId: workspace.courseId, ...(sourceCourseId !== workspace.courseId ? { sourceCourseId } : {}), tool: mode, relPath: selectedFile ?? (browser ? null : workspace.kind === 'project' && workspace.rootRelPath ? workspace.rootRelPath : null),
      ...(useCurrent && source.courseId === sourceCourseId && !explicitBrowser && source.selection && (!explicitFile || source.material?.relPath === explicitFile) ? { selection: source.selection } : {}),
      ...(browser && !selectedFile ? { ...(browser.tabId ? { browserTabId: browser.tabId } : {}), browserTabUrl: browser.url } : {}), conversation })
    return
  }
  if (!ai.model || ['default', 'auto'].includes(ai.model)) throw new Error('입력창에서 사용할 AI 모델을 먼저 선택해 주세요.')
  let binding: LearningBinding | undefined = workspace.kind === 'project' ? { courseId: workspace.courseId, rootRelPath: workspace.rootRelPath } : undefined
  if (browser && !selectedFile && !binding) {
    const existing = (await invoke('learning:list', { courseId: workspace.courseId })).projects.find(project => !project.deletedAt && project.purpose === 'course-review' && project.linkedCourseId === workspace.courseId)
    binding = existing?.binding ?? (await invoke('learning:create', { placement: 'standalone', name: `${source.courseName ?? '과목'} 복습`, topic: '과목 자료', purpose: 'course-review', linkedCourseId: workspace.courseId, ai })).binding
  }
  let generationSource: LearningGenerationSource = selectedFile ? { kind: 'material', relPath: selectedFile, sourceCourseId, ...(useCurrent && source.material?.courseId === sourceCourseId && source.material?.relPath === selectedFile ? { ...(source.selection ? { selection: source.selection } : {}), ...(source.material.page ? { page: source.material.page } : {}) } : {}) } : { kind: 'course', sourceCourseId: workspace.courseId }
  if (useCurrent && original?.kind === 'learning-resource' && !explicitFile && (!binding || binding.courseId === original.payload.courseId && binding.rootRelPath === original.payload.rootRelPath)) {
    binding = { courseId: original.payload.courseId, rootRelPath: original.payload.rootRelPath }
    const resource = original.payload.resource
    if (resource.kind === 'article') generationSource = { kind: 'article', articleIds: [resource.id], sourceCourseId: binding.courseId }
    if (resource.kind === 'vocabulary') {
      const project = await invoke('learning:get', { binding })
      generationSource = { kind: 'vocabulary', wordIds: project.words.map(word => word.id), sourceCourseId: binding.courseId }
    }
  } else if (browser && binding && !selectedFile) {
    const article = await invoke('learning:addArticle', { binding, url: browser.url, ...(browser.tabId ? { tabId: browser.tabId } : {}), sourceCourseId })
    generationSource = { kind: 'article', articleIds: [article.addedArticleId], sourceCourseId: binding.courseId }
  }
  await invoke('study:generate', { courseId: workspace.courseId, packId: mode, ...(binding ? { binding } : {}), source: generationSource, ai, conversation })
}
