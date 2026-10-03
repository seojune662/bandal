import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearningProjectSummary } from '../../../../shared/types/learning'
import { Icon } from '../../app/icons'
import { invoke, onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { LearningCreateDialog } from './LearningCreateDialog'
import { LEARNING_CHANGED_EVENT, learningError, openLearning, openLearningOverview } from './learningNavigation'
import './learning.css'

export function useLearningProjects(courseId?: string): { projects: LearningProjectSummary[]; loading: boolean; error: string | null; reload: () => Promise<void> } {
  const [projects, setProjects] = useState<LearningProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    try { const result = await invoke('learning:list', courseId ? { courseId } : {}); if (request === sequence.current) { setProjects(result.projects); setError(null) } }
    catch (caught) { if (request === sequence.current) setError(learningError(caught)) }
    finally { if (request === sequence.current) setLoading(false) }
  }, [courseId])
  useEffect(() => { setLoading(true); let disposed = false
    const load = (): void => { if (!disposed) void reload() }
    load(); window.addEventListener(LEARNING_CHANGED_EVENT, load)
    const stop = onPush('learning:changed', event => { if (!courseId || event.binding.courseId === courseId) load() })
    const stopMaterials = onPush('materials:changed', event => { if (!courseId || event.courseId === courseId) load() })
    return () => { disposed = true; sequence.current += 1; stop(); stopMaterials(); window.removeEventListener(LEARNING_CHANGED_EVENT, load) }
  }, [reload])
  return { projects, loading, error, reload }
}

export function LearningSidebar({ courseId, compact = false }: { courseId?: string; compact?: boolean }): JSX.Element {
  const { projects, error, reload } = useLearningProjects(courseId)
  const [creating, setCreating] = useState(false)
  const selectedCourseId = useCoursesStore(state => state.selectedCourseId)
  return <section className={`learning-sidebar${compact ? ' learning-sidebar--compact' : ''}`} aria-label="학습 공간">
    <div className="learning-sidebar__heading"><button type="button" className="learning-sidebar__title" onClick={() => { const id = courseId ?? selectedCourseId; if (id) openLearningOverview(id); else setCreating(true) }}>학습 공간</button><button type="button" className="bare-icon-button" aria-label="새 영어 학습 공간" onClick={() => setCreating(true)}><Icon name="plus" /></button></div>
    {projects.map(project => <button type="button" key={`${project.binding.courseId}:${project.binding.rootRelPath}`} className="learning-sidebar__project" title={project.warning ?? project.topic} onClick={() => openLearning(project.binding)}><Icon name="graph" /><span>{project.name}</span>{project.dueCardCount > 0 && <small>{project.dueCardCount}</small>}</button>)}
    {error && <button type="button" className="learning-sidebar__retry" onClick={() => void reload()}>학습 공간 다시 불러오기</button>}
    {creating && <LearningCreateDialog {...(courseId ? { courseId } : {})} onClose={() => setCreating(false)} />}
  </section>
}

export function LearningProjectsHome({ courseId }: { courseId: string }): JSX.Element {
  const { projects, loading, error, reload } = useLearningProjects(courseId)
  const [creating, setCreating] = useState(false)
  return <div className="learning-panel"><div className="learning-page learning-projects-home"><p className="learning-eyebrow">MY LEARNING SPACE</p><h1>읽고, 만나고, 쌓아가요.</h1><p className="learning-lead">영어 기사, 나의 단어, 퀴즈와 카드가 하나의 학습 흐름으로 이어집니다.</p><button className="button button--primary" type="button" onClick={() => setCreating(true)}><Icon name="plus" /> 영어 읽기 시작하기</button>
    {loading && <p role="status" className="learning-muted">학습 공간 불러오는 중…</p>}{error && <p role="alert">{error} <button type="button" onClick={() => void reload()}>다시 시도</button></p>}
    <div className="learning-project-grid">{projects.map(project => <button type="button" className="learning-project-card" key={project.binding.rootRelPath} onClick={() => openLearning(project.binding)}><span className="learning-project-card__icon"><Icon name="graph" /></span><strong>{project.name}</strong><span>{project.topic || '자료를 복습하는 학습 공간'}</span><small>읽은 글 {project.completedArticleCount} · 단어 {project.wordCount} · 복습 카드 {project.dueCardCount}</small>{project.warning && <em>{project.warning}</em>}</button>)}</div>
    {!loading && projects.length === 0 && <div className="learning-empty"><span>첫 번째 글에서 시작해 보세요.</span><p>좋아하는 주제를 고르면 AI가 짧은 영어 글을 찾아드려요.</p></div>}
  </div>{creating && <LearningCreateDialog courseId={courseId} onClose={() => setCreating(false)} />}</div>
}
