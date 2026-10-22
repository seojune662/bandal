import { takeStartedLearningRuns } from '../learning/learningStartedRuns'
import { useState, useRef } from 'react'
import type { LearningBinding, LearningDraft, LearningRun } from '../../../../shared/types/learning'
import { invoke } from '../../lib/ipc'
import { useUiStore } from '../../stores/uiStore'
import { LearningDraftPreview } from '../learning/LearningDraftPreview'
import { LearningRunStatus } from '../learning/LearningRunStatus'
import { LearningCreateDialog } from '../learning/LearningCreateDialog'
import { isLearningRunActive } from '../learning/learningRunPresentation'
import { learningError, openLearning } from '../learning/learningNavigation'
import { refreshLearningProject, updateLearningProjectSnapshot, useLearningProject } from '../learning/useLearningProject'
import '../learning/learning.css'

/** Background work and import confirmations remain reachable after the old dashboard is retired. */
export function ProjectAssistantRuns({ binding }: { binding: LearningBinding }): JSX.Element | null {
  const historical = useRef<Set<string> | null>(null)
  const { project, error: loadError } = useLearningProject(binding)
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [settings, setSettings] = useState(false)
  const perform = async (operation: () => Promise<unknown>): Promise<void> => {
    setPending(true); setError('')
    try { await operation(); await refreshLearningProject(binding) }
    catch (cause) { setError(learningError(cause)) }
    finally { setPending(false) }
  }
  if (!project) return loadError ? <p className="learning-error" role="alert">{loadError}</p> : null
  historical.current ??= new Set(project.runs.filter(run => !isLearningRunActive(run)).map(run => run.id))
  for (const id of takeStartedLearningRuns(binding, project.runs)) historical.current.delete(id)
  const previews = project.runs.filter(run => run.status === 'awaiting-confirmation' && run.draft)
  const current = project.runs.filter(run => isLearningRunActive(run) || ['failed', 'interrupted'].includes(run.status) && !run.dismissedAt && !historical.current!.has(run.id))
  const history = [...project.runs].reverse().filter(run => !previews.includes(run) && !current.includes(run))
  const renderRun = (run: LearningRun): JSX.Element => <LearningRunStatus key={run.id} run={run} ai={project.ai} pending={pending}
    {...(project.purpose !== 'english-reading' && run.kind === 'find-articles' ? { retryUnavailableReason: '영어 글 찾기는 영어 읽기 프로젝트에서 시작해 주세요.' } : {})}
    onCancel={() => void perform(() => invoke('learning:runCancel', { binding, runId: run.id }))}
    onRetry={() => void perform(() => invoke('learning:runRetry', { binding, runId: run.id }))}
    onSettings={() => setSettings(true)} onConnection={() => useUiStore.getState().openSettings('ai')}
    {...(!isLearningRunActive(run) && !run.dismissedAt ? { onDismiss: () => void perform(() => invoke('learning:dismissRun', { binding, runId: run.id })) } : {})}
    {...(run.resultArticleIds?.[0] ? { onOpenResult: () => openLearning(binding, 'reader', run.resultArticleIds![0]) } : run.resultArtifactIds?.[0] ? { onOpenResult: () => openLearning(binding, 'review', run.resultArtifactIds![0]) } : {})} />
  const save = (run: LearningRun, draft: LearningDraft): void => { void perform(async () => { updateLearningProjectSnapshot(await invoke('learning:importSave', { binding, runId: run.id, draft })) }) }
  return <section className="workspace-assistant__jobs" aria-label="프로젝트 AI 작업">
    {error && <p className="learning-error" role="alert">{error}</p>}
    {previews.map(run => <details key={run.id} open><summary>저장 전 확인이 필요해요</summary><LearningDraftPreview key={run.id} run={run} pending={pending} onSave={draft => save(run, draft)} onCancel={() => void perform(() => invoke('learning:runCancel', { binding, runId: run.id }))} /></details>)}
    {current.map(renderRun)}
    {history.length > 0 && <details><summary>작업 기록 · {history.length}</summary>{history.map(renderRun)}</details>}
    {settings && <LearningCreateDialog project={project} onClose={() => setSettings(false)} onCreated={() => void refreshLearningProject(binding)} />}
  </section>
}
