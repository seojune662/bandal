import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearningProjectSummary } from '../../../../shared/types/learning'
import { Icon } from '../../app/icons'
import { invoke, onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { LearningCreateDialog } from './LearningCreateDialog'
import { learningPurpose } from './learningPurpose'
import { LEARNING_CHANGED_EVENT, learningError, openLearning, openLearningOverview, rememberEnglishBinding } from './learningNavigation'
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
    const stop = onPush('learning:changed', () => { load() })
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
    {projects.map(project => <button type="button" key={`${project.binding.courseId}:${project.binding.rootRelPath}`} className="learning-sidebar__project" title={project.warning ?? project.topic} onClick={() => { if (project.purpose === 'english-reading' && project.readingSetupConfirmed) rememberEnglishBinding(project.binding); openLearning(project.binding) }}><Icon name="graph" /><span>{project.name}</span>{project.dueCardCount > 0 && <small>{project.dueCardCount}</small>}</button>)}
    {error && <button type="button" className="learning-sidebar__retry" onClick={() => void reload()}>학습 공간 다시 불러오기</button>}
    {creating && <LearningCreateDialog {...(courseId ? { courseId } : {})} onClose={() => setCreating(false)} />}
  </section>
}

export function LearningProjectGroups({ projects, compact = false }: { projects: LearningProjectSummary[]; compact?: boolean }): JSX.Element {
  const courses = useCoursesStore(state => state.courses)
  const groups = [
    { purpose: 'english-reading', title: '영어 이어읽기', empty: '아직 영어 읽기 공간이 없어요.' },
    { purpose: 'course-review', title: '과목 복습', empty: '과목 자료에서 퀴즈·카드를 만들면 이곳에 모입니다.' },
    { purpose: 'unclassified', title: '종류 확인 필요', empty: '' }
  ]
  return <>{groups.map(group => {
    const items = projects.filter(project => learningPurpose(project) === group.purpose).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (!items.length && group.purpose === 'unclassified') return null
    return <section className="learning-space-group" aria-label={group.title} key={group.purpose}><h3>{group.title}<small>{items.length}</small></h3>
      <div className={compact ? 'learning-spaces-list' : 'learning-project-grid'}>{items.map(project => <button type="button" className={compact ? 'learning-space-row' : 'learning-project-card'} key={`${project.binding.courseId}:${project.binding.rootRelPath}`} onClick={() => { if (project.purpose === 'english-reading' && project.readingSetupConfirmed) rememberEnglishBinding(project.binding); openLearning(project.binding) }}>
        <strong>{project.name}</strong><span>{group.purpose === 'course-review' ? `${courses.find(course => course.id === project.linkedCourseId)?.name ?? '원본 과목'} · 퀴즈와 카드` : group.purpose === 'unclassified' ? '기존 기록 보존 · 공간에서 종류를 확인해 주세요' : project.topic}</span><small>{group.purpose === 'course-review' ? `오늘 복습 대기 ${project.dueCardCount}` : `${group.purpose === 'english-reading' ? `읽은 글 ${project.completedArticleCount} · 표현 ${project.wordCount}` : `단어 ${project.wordCount}`} · 복습 ${project.dueCardCount}`}</small>{project.warning && <em>{project.warning}</em>}
      </button>)}</div>{!items.length && <p className="learning-muted">{group.empty}</p>}
    </section>
  })}</>
}

export function LearningProjectsHome({ courseId }: { courseId: string }): JSX.Element {
  const { projects, loading, error, reload } = useLearningProjects(courseId)
  const [creating, setCreating] = useState(false)
  return <div className="learning-panel"><div className="learning-page learning-projects-home"><p className="learning-eyebrow">MY LEARNING SPACE</p><h1>나의 학습 공간</h1><p className="learning-lead">영어 이어읽기와 과목 복습을 각각의 공간에서 이어가세요.</p><button className="button button--primary" type="button" onClick={() => setCreating(true)}><Icon name="plus" /> 영어 이어읽기 시작하기</button>
    {loading && <p role="status" className="learning-muted">학습 공간 불러오는 중…</p>}{error && <p role="alert">{error} <button type="button" onClick={() => void reload()}>다시 시도</button></p>}
    <LearningProjectGroups projects={projects} />
  </div>{creating && <LearningCreateDialog onClose={() => setCreating(false)} />}</div>
}
