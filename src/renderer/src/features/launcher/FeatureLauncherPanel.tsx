import { useEffect, useMemo, useRef, useState } from 'react'
import type { LearningBinding, LearningProjectSummary } from '../../../../shared/types/learning'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke, onPush } from '../../lib/ipc'
import { useUiStore } from '../../stores/uiStore'
import { useCoursesStore } from '../../stores/coursesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { requestLearningArticleImport, requestLearningCreation } from '../learning/LearningDialogsHost'
import { useLearningProjects } from '../learning/LearningProjects'
import { isEnglishReading, learningPurposeLabel } from '../learning/learningPurpose'
import { openLearning } from '../learning/learningNavigation'
import { useFeatureInventory, type FeatureEntry } from './featureInventory'
import { useLauncherContext, refreshLauncherContext, type LauncherContext } from './launcherContext'
import { executeFeatureAction, featureActionDisabledReason, type FeatureActionScope } from './featureActions'
import './launcher.css'

interface ActionStatus {
  phase: 'pending' | 'requested' | 'available' | 'started' | 'complete' | 'failed'
  message: string
  binding?: LearningBinding
  runId?: string
  courseId?: string
  relPath?: string
}
interface ProjectPicker {
  entry: FeatureEntry
  context: LauncherContext
  scope: FeatureActionScope
  projects: LearningProjectSummary[]
}
const QUICK_PACKS = ['vocab-chain-en', 'quiz', 'flashcards']
const RUN_LABELS: Record<string, string> = {
  queued: '실행 대기 중', running: 'AI가 자료를 만드는 중', validating: '결과 확인 중',
  interrupted: '실행이 중단됐어요', 'awaiting-confirmation': '확인이 필요해요',
  complete: '완료', failed: '실행하지 못했어요', cancelled: '취소됨'
}
function containsMaterial(nodes: MaterialNode[], relPath: string): boolean {
  return nodes.some(node => node.relPath === relPath || !!node.children && containsMaterial(node.children, relPath))
}

export function FeatureLauncherPanel({ hidden }: { hidden: boolean }): JSX.Element {
  const { entries, loading, error, reload } = useFeatureInventory()
  const { context, loading: contextLoading, error: contextError } = useLauncherContext()
  const { projects, error: projectsError } = useLearningProjects()
  const courses = useCoursesStore(state => state.courses)
  const railOpen = useUiStore(state => state.leftRailOpen && state.courseRailOpen)
  const settingsOpen = useUiStore(state => state.isSettingsOpen)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<FeatureActionScope>('material')
  const [statuses, setStatuses] = useState<Record<string, ActionStatus>>({})
  const [picker, setPicker] = useState<ProjectPicker | null>(null)
  const statusRef = useRef(statuses); statusRef.current = statuses
  const input = useRef<HTMLInputElement>(null)
  const pendingActions = useRef(new Set<string>())
  useEffect(() => {
    if (hidden || !railOpen || settingsOpen) return
    const element = input.current
    if (!element) return
    const focus = (): boolean => {
      if (!element.isConnected || element.closest('[inert], [hidden]')) return false
      element.focus({ preventScroll: true })
      return document.activeElement === element
    }
    if (focus()) return
    // Settings keeps the surrounding rail inert during its exit transition.
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect() })
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert', 'hidden'] })
    return () => observer.disconnect()
  }, [hidden, railOpen, settingsOpen])
  useEffect(() => {
    setScope(context.selection ? 'selection' : context.material?.relPath || context.browser || context.binding ? 'material' : 'course')
    setPicker(null)
  }, [context.courseId, context.sourcePanelId, context.selection, context.browser?.url])

  useEffect(() => {
    const refreshRuns = async (binding: LearningBinding): Promise<void> => {
      const pending = Object.entries(statusRef.current).filter(([, item]) => item.runId && item.binding?.courseId === binding.courseId && item.binding.rootRelPath === binding.rootRelPath)
      if (!pending.length) return
      try {
        const project = await invoke('learning:get', { binding })
        setStatuses(previous => {
          const next = { ...previous }
          for (const [id, captured] of pending) {
            if (next[id]?.runId !== captured.runId) continue
            const run = project.runs.find(item => item.id === captured.runId)
            if (!run) continue
            next[id] = { ...captured, phase: run.status === 'complete' ? 'complete' : ['failed', 'cancelled', 'interrupted'].includes(run.status) ? 'failed' : 'started', message: run.error || RUN_LABELS[run.status] || run.message }
          }
          return next
        })
      } catch { /* A transient read does not turn an executing run into a failure. */ }
    }
    const stop = onPush('learning:changed', ({ binding }) => { void refreshRuns(binding) })
    for (const item of Object.values(statusRef.current)) if (item.binding && item.phase === 'started') void refreshRuns(item.binding)
    return stop
  }, [Object.values(statuses).map(item => item.runId).join('|')])
  useEffect(() => {
    const refreshFiles = async (courseId: string): Promise<void> => {
      const requested = Object.entries(statusRef.current).filter(([, item]) => item.phase === 'requested' && item.courseId === courseId)
      if (!requested.length) return
      try {
        const tree = await invoke('materials:tree', { courseId })
        setStatuses(previous => {
          const next = { ...previous }
          for (const [id, item] of requested) if (item.relPath && next[id]?.relPath === item.relPath && containsMaterial(tree, item.relPath)) {
            next[id] = { ...item, phase: 'available', message: '생성된 자료를 열 수 있어요.' }
          }
          return next
        })
      } catch { /* Keep the request state until a material update confirms the file. */ }
    }
    const stop = onPush('materials:changed', ({ courseId }) => { void refreshFiles(courseId) })
    for (const item of Object.values(statusRef.current)) if (item.phase === 'requested' && item.courseId) void refreshFiles(item.courseId)
    return stop
  }, [Object.values(statuses).map(item => item.relPath).join('|')])

  const run = async (entry: FeatureEntry, source = context, targetScope = scope, binding?: LearningBinding): Promise<void> => {
    if (pendingActions.current.has(entry.id) || statusRef.current[entry.id]?.phase === 'started') return
    pendingActions.current.add(entry.id)
    setPicker(null)
    setStatuses(previous => ({ ...previous, [entry.id]: { phase: 'pending', message: '실행 준비 중…' } }))
    try {
      const result = await executeFeatureAction(entry, source, targetScope, binding ? { binding } : undefined)
      if (result.status === 'needs-project-picker') {
        setPicker({ entry, context: source, scope: targetScope, projects: result.projects })
        setStatuses(previous => { const next = { ...previous }; delete next[entry.id]; return next })
      } else if (result.status === 'needs-course') {
        useUiStore.getState().showCourses()
        showToast('먼저 과목을 선택해 주세요.', 'info')
        setStatuses(previous => { const next = { ...previous }; delete next[entry.id]; return next })
      } else if (result.status === 'failed') {
        setStatuses(previous => ({ ...previous, [entry.id]: { phase: 'failed', message: result.message } }))
      } else {
        setStatuses(previous => ({ ...previous, [entry.id]: {
          phase: result.status === 'started' ? 'started' : result.status === 'dispatched' ? 'requested' : 'complete',
          message: result.message,
          ...('binding' in result && result.binding ? { binding: result.binding } : {}),
          ...('runId' in result && result.runId ? { runId: result.runId } : {}),
          ...('relPath' in result && result.relPath && source.courseId ? { relPath: result.relPath, courseId: source.courseId } : {})
        } }))
      }
    } catch (caught) {
      setStatuses(previous => ({ ...previous, [entry.id]: { phase: 'failed', message: caught instanceof Error ? caught.message : '실행하지 못했어요.' } }))
    } finally {
      pendingActions.current.delete(entry.id)
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return entries.filter(entry => !needle || `${entry.label} ${entry.description} ${entry.kind === 'pack' && entry.packId === 'vocab-chain-en' ? '영어 단어 사슬' : ''} ${entry.kind !== 'pack' ? entry.pluginName : ''}`.toLocaleLowerCase().includes(needle))
  }, [entries, query])
  const quick = QUICK_PACKS.flatMap(id => filtered.filter(entry => entry.kind === 'pack' && entry.packId === id))
  const others = filtered.filter(entry => !quick.includes(entry))
  const title = context.material?.title || context.browser?.title || (context.binding ? '현재 학습 공간' : '과목 전체')
  const courseName = courses.find(course => course.id === context.courseId)?.name
  const card = (entry: FeatureEntry): JSX.Element => {
    const status = statuses[entry.id]
    const reason = featureActionDisabledReason(entry, context, scope)
    const busy = status?.phase === 'pending' || status?.phase === 'started'
    return <article className="launcher-feature" key={entry.id} data-kind={entry.kind}>
      <button type="button" className="launcher-feature__action" disabled={!!reason || busy || contextLoading}
        title={reason ?? entry.description} onClick={() => void run(entry)}>
        <span className="launcher-feature__icon" aria-hidden="true">{entry.kind === 'pack' ? entry.experience === 'article-vocabulary' ? 'Aa' : entry.experience === 'quiz' ? '?' : entry.experience === 'flashcards' ? '▤' : '✦' : <Icon name="puzzle" />}</span>
        <span><strong>{entry.label}</strong><small className="launcher-feature__type">{entry.kind === 'pack' ? entry.schemaVersion === 1 ? '문서 생성 팩 · 기존 방식' : '앱 학습 기능' : '확장 플러그인'}</small><small>{entry.description}</small>{entry.kind === 'pack' && entry.experience === 'article-vocabulary' && <small>관심 주제와 영어 학습 공간으로 실행</small>}</span>
      </button>
      {reason && <p className="launcher-feature__reason">{reason}</p>}
      {status && <div className="launcher-feature__status" role="status" data-phase={status.phase}>
        <span>{status.message}</span>
        {status.binding && <button type="button" onClick={() => openLearning(status.binding!, entry.kind === 'pack' && entry.experience === 'article-vocabulary' ? 'home' : 'review')}>{status.phase === 'complete' ? '결과 열기' : '진행 보기'}</button>}
        {status.relPath && status.courseId && status.phase === 'available' && <button type="button" onClick={() => {
          useCoursesStore.getState().selectCourse(status.courseId!)
          const workspace = useWorkspaceStore.getState()
          workspace.setActiveCourse(status.courseId!)
          workspace.openTab(descriptorFor('file', { courseId: status.courseId!, relPath: status.relPath! }))
        }}>결과 열기</button>}
      </div>}
    </article>
  }

  return <aside id="plugins-panel" className="app-rail app-rail--left feature-launcher" aria-label="플러그인 기능" hidden={hidden}>
    <header className="launcher-header"><div><p>바로 실행</p><h2>플러그인</h2></div><button type="button" className="bare-icon-button" aria-label="기능 새로고침" onClick={() => void reload()}><Icon name="refresh" /></button></header>
    <label className="launcher-search"><Icon name="search" /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="기능 검색" aria-label="기능 검색" /></label>
    <section className="launcher-target" aria-label="현재 실행 대상">
      <span className="launcher-section-label">현재 실행 대상</span>
      <strong>{courseName ?? '과목을 선택해 주세요'}</strong>
      {context.courseId && <span title={context.material?.relPath || context.browser?.url}>{title}{context.material?.page ? ` · ${context.material.page}페이지` : ''}</span>}
      {context.selection && <blockquote title={context.selection}>{context.selection.slice(0, 160)}</blockquote>}
      <label><span className="sr-only">실행 범위</span><select aria-label="실행 범위" value={scope} onChange={event => setScope(event.target.value as FeatureActionScope)}>
        {context.selection && <option value="selection">선택한 부분</option>}
        {(context.material?.relPath || context.browser || context.binding) && <option value="material">{context.binding ? context.articleIds.length ? '현재 기사' : '현재 학습 공간' : context.browser ? '현재 웹페이지' : '현재 자료'}</option>}
        <option value="course">과목 전체</option>
      </select></label>
      {context.browser && context.courseId && <button className="launcher-inline-action" type="button" disabled={contextLoading || context.sourceUnavailable} onClick={() => {
        void refreshLauncherContext(context).then(source => {
          if (source.browser && source.courseId) requestLearningArticleImport({ courseId: source.courseId, url: source.browser.url, tabId: source.browser.tabId })
        }).catch(caught => showToast(caught instanceof Error ? caught.message : '현재 글을 확인하지 못했어요.', 'danger'))
      }}>현재 글을 영어 학습에 추가 <Icon name="plus" /></button>}
      {(contextLoading || contextError) && <p role={contextError ? 'alert' : 'status'}>{contextError || '자료 확인 중…'}</p>}
    </section>
    <div className="launcher-scroll">
      {error && <p className="launcher-error" role="alert">{error} <button type="button" onClick={() => void reload()}>다시 불러오기</button></p>}
      {loading && <p className="launcher-empty" role="status">기능을 불러오는 중…</p>}
      {quick.length > 0 && <section aria-label="학습 바로가기"><h3 className="launcher-section-label">학습 바로가기</h3>{quick.map(card)}</section>}
      {picker && <section className="launcher-picker" aria-label="학습 공간 선택"><h3>어디에서 이어갈까요?</h3>{picker.projects.map(project => <button type="button" key={`${project.binding.courseId}:${project.binding.rootRelPath}`} onClick={() => void run(picker.entry, picker.context, picker.scope, project.binding)}><strong>{project.name}</strong><span>{project.topic || '학습 자료'}{!isEnglishReading(project) ? ' · 설정 확인 필요' : ''}</span></button>)}<button type="button" onClick={() => { requestLearningCreation(undefined, picker.entry.kind === 'pack' ? picker.entry.packId : undefined); setPicker(null) }}>새 학습 공간 만들기</button></section>}
      {others.length > 0 && <section aria-label="전체 기능"><h3 className="launcher-section-label">전체 기능</h3>{others.map(card)}</section>}
      {!loading && filtered.length === 0 && <p className="launcher-empty">{query ? '검색한 기능이 없어요.' : '사용할 수 있는 기능이 없어요. 플러그인 관리에서 추가해 보세요.'}</p>}
      {!query && <section className="launcher-projects" aria-label="이어갈 학습 공간"><div className="launcher-section-heading"><h3 className="launcher-section-label">이어갈 학습 공간</h3><button type="button" className="bare-icon-button" aria-label="새 학습 공간 만들기" onClick={() => requestLearningCreation()}><Icon name="plus" /></button></div>
        {[...projects].sort((a, b) => Number(b.binding.courseId === context.courseId) - Number(a.binding.courseId === context.courseId)).map(project => <button type="button" className="launcher-project" key={`${project.binding.courseId}:${project.binding.rootRelPath}`} onClick={() => openLearning(project.binding)}><strong>{project.name}</strong><span>{learningPurposeLabel(project)} · {project.topic || '학습 자료'}</span><small>읽은 글 {project.completedArticleCount} · 표현 {project.wordCount} · 복습 {project.dueCardCount}</small></button>)}
        {projects.length === 0 && <button type="button" className="launcher-inline-action" onClick={() => requestLearningCreation()}>영어 읽기 시작하기 <Icon name="plus" /></button>}
        {projectsError && <p role="alert">{projectsError}</p>}
      </section>}
    </div>
    <footer className="launcher-footer"><button type="button" onClick={() => useUiStore.getState().openSettings('packs')}><Icon name="settings" /> 플러그인 관리 <Icon name="chevronRight" /></button></footer>
  </aside>
}
