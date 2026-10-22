import { useChatSessionStore } from './chatSessionStore'
import { workspaceFromKey } from '../../../../shared/types/workspace'
import { openWorkspaceAssistant } from '../assistantPanel/assistantController'
import { useWorkspaceAssistantStore } from '../assistantPanel/workspaceAssistantStore'
import { updateComposerDraft } from './composerDraftStore'
import type { MaterialNode } from '../../../../shared/types/materials'
import { useCallback, useEffect, useState } from 'react'
import type { ChatArtifact } from '../../../../shared/types/chatCapabilities'
import type { LearningProjectSnapshot, LearningRun } from '../../../../shared/types/learning'
import { invoke, onPush } from '../../lib/ipc'
import { openLearning } from '../learning/learningNavigation'
import { useUiStore } from '../../stores/uiStore'

function containsMaterial(nodes: MaterialNode[], path: string): boolean { return nodes.some(node => node.relPath === path || !!node.children && containsMaterial(node.children, path)) }
export function StudyResultCard({ artifact }: { artifact: ChatArtifact }): JSX.Element {
  const [project, setProject] = useState<LearningProjectSnapshot | null>(null)
  const [available, setAvailable] = useState(!artifact.pending)
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const learning = artifact.learning
  const generating = useChatSessionStore(state => artifact.workflow ? state.sessions[artifact.workflow.sessionId]?.state.streaming ?? false : false)
  const retryWorkflow = (): void => {
    if (!artifact.workflow) return
    const workspace = workspaceFromKey(artifact.workflow.workspaceKey)
    const id = openWorkspaceAssistant(workspace, { conversationId: artifact.workflow.sessionId, text: artifact.workflow.content })
    useWorkspaceAssistantStore.getState().setMode(workspace, 'exam-predictions')
    updateComposerDraft(id, draft => ({ references: [...(draft.references ?? []), ...(artifact.workflow?.context?.references ?? []).filter(ref => !draft.references?.some(current => current.id === ref.id))], files: [...draft.files, ...(artifact.workflow?.context?.files ?? []).filter(file => !draft.files.some(current => current.relPath === file.relPath))] }))
  }
  const reload = useCallback(async () => {
    try {
      if (learning) setProject(await invoke('learning:get', { binding: learning.binding }))
      else { const tree = await invoke('materials:tree', { courseId: artifact.courseId }); setAvailable(containsMaterial(tree, artifact.relPath)) }
    } catch { if (!learning) setAvailable(false) }
  }, [learning, artifact.courseId, artifact.relPath])
  useEffect(() => { void reload(); const stop = learning ? onPush('learning:changed', event => { if (event.binding.courseId === learning.binding.courseId && event.binding.rootRelPath === learning.binding.rootRelPath) void reload() }) : onPush('materials:changed', event => { if (event.courseId === artifact.courseId) void reload() }); return stop }, [reload, learning, artifact.courseId])
  let run: LearningRun | undefined = project?.runs.find(item => item.id === learning?.runId)
  for (let index = 0; run && index < 20; index++) { const retry = project?.runs.find(item => item.retryOf === run?.id); if (!retry) break; run = retry }
  const finished = run?.status === 'complete', failed = !!run && ['failed', 'cancelled', 'interrupted'].includes(run.status)
  const action = (task: () => Promise<unknown>) => { setPending(true); setError(''); void task().then(reload).catch(cause => setError(cause instanceof Error ? cause.message : '작업을 처리하지 못했어요.')).finally(() => setPending(false)) }
  return <article className="chat-study-card" aria-label={`${artifact.name} 결과`}><strong>{artifact.name}</strong><p role="status">{learning ? run?.error || run?.message || '작업 상태를 불러오는 중…' : available ? '생성한 자료를 열 수 있어요.' : generating ? 'AI가 자료를 만드는 중이에요. 파일이 준비되면 열 수 있어요.' : '결과 파일이 아직 없어요. 응답을 확인하거나 같은 요청을 다시 작성할 수 있어요.'}</p>{error && <p role="alert">{error}</p>}<div className="chat-study-card__actions">
    {learning && run ? finished ? <button type="button" onClick={() => openLearning(learning.binding, run.resultArticleIds?.length ? 'reader' : 'review', run.resultArticleIds?.[0] ?? run.resultArtifactIds?.[0])}>결과 열기</button> : failed ? <><button disabled={pending} onClick={() => action(() => invoke('learning:runRetry', { binding: learning.binding, runId: run!.id }))}>다시 시도</button><button onClick={() => useUiStore.getState().openSettings('ai')}>AI 연결 설정</button></> : <button disabled={pending} onClick={() => action(() => invoke('learning:runCancel', { binding: learning.binding, runId: run!.id }))}>중지</button> : !learning && <><button type="button" disabled={!available} onClick={() => void invoke('chat:openArtifact', { courseId: artifact.courseId, relPath: artifact.relPath }).catch(cause => setError(String(cause)))}>열기</button>{!available && artifact.workflow && (generating ? <button disabled={pending} onClick={() => action(() => invoke('chat:cancel', { courseId: artifact.courseId, sessionId: artifact.workflow!.sessionId }))}>중지</button> : <button onClick={retryWorkflow}>같은 요청 다시 작성</button>)}</>}
  </div></article>
}
