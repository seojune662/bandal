import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { projectBindingKey, type ProjectGroup, type ProjectNavigation } from '../../../../shared/projectNavigation'
import type { LearningProjectSummary } from '../../../../shared/types/learning'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { NewLearningDialog } from './NewLearningDialog'
import { learningDisplayName } from './learningPresentation'
import { useCoursesStore } from '../../stores/coursesStore'
import { useLearningProjects } from './LearningProjects'
import { HomeTabs } from '../courses/HomeTabs'
import { CourseGroupNameDialog, DeleteCourseGroupDialog } from '../courses/CourseGroupDialogs'
import { LearningSpaceMenu, restoreLearningSpace } from './LearningSpaceManagement'
import { learningError, openLearning } from './learningNavigation'
import { initializeProjectNavigation, moveProject } from './projectNavigationModel'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { ProjectFolderContents } from './ProjectFolderContents'
import { ProjectGroupMenu } from './ProjectGroupMenu'
import { useDismissableMenu } from '../../components/useDismissableMenu'
import { useViewportBounds } from '../../lib/useViewportBounds'
import { useWorkspaceCourseHover } from '../courses/useWorkspaceCourseHover'
import { workspaceKey } from '../../../../shared/types/workspace'
import './learning.css'
import './projectNavigation.css'

const DRAG = 'application/x-bandal-project-navigation'
function readCollapsed(): string[] { try { const value: unknown = JSON.parse(localStorage.getItem('bandal:project-groups-collapsed') ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [] } catch { return [] } }

export function LearningSpacesPanel({ hidden }: { hidden: boolean }): JSX.Element {
  const { projects, loading, error, reload } = useLearningProjects(undefined, true)
  const courses = useCoursesStore(state => state.courses)
  const workspace = useWorkspaceStore(state => state.activeWorkspace)
  const [nav, setNav] = useState<ProjectNavigation | null>(null)
  const [navError, setNavError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>(() => { try { const value: unknown = JSON.parse(localStorage.getItem('bandal:projects-expanded') ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] } })
  const hover = useWorkspaceCourseHover()
  const toggleProject = (key: string): void => setExpanded(current => { const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key]; try { localStorage.setItem('bandal:projects-expanded', JSON.stringify(next)) } catch { /* Optional UI preference. */ } return next })
  const [creating, setCreating] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [groupDialog, setGroupDialog] = useState<ProjectGroup | 'new' | null>(null)
  const [deleteGroup, setDeleteGroup] = useState<ProjectGroup | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed)
  const [showDeleted, setShowDeleted] = useState(false)
  const saving = useRef(false)
  const navigationSequence = useRef(0)
  const [syncEpoch, setSyncEpoch] = useState(0)
  const newGroup = useRef<{ groupId: string | null; existing: Set<string> } | null>(null)
  const [dragging, setDragging] = useState<{ kind: 'project' | 'group'; key: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const closeAdd = useCallback(() => setAddOpen(false), [])
  useDismissableMenu(addOpen, menu, closeAdd)
  useViewportBounds(menu)
  const loadNavigation = (): void => setSyncEpoch(value => value + 1)
  useEffect(() => groupDialog || deleteGroup || addOpen ? acquirePointerPassthrough() : undefined, [groupDialog, deleteGroup, addOpen])
  const save = async (next: ProjectNavigation): Promise<void> => {
    if (saving.current) throw new Error('이전 변경을 저장 중입니다. 잠시 후 다시 시도해 주세요.')
    saving.current = true
    navigationSequence.current++
    try { setNav(await invoke('projects:saveNavigation', next)); setNavError(null) } catch (error) { void invoke('projects:navigation', {}).then(setNav).catch(() => {}); throw error } finally { saving.current = false }
  }
  useEffect(() => {
    if (loading || error) return
    const request = ++navigationSequence.current
    let live = true
    void invoke('projects:navigation', {}).then(async current => {
      if (!live || request !== navigationSequence.current) return
      if (saving.current) { loadNavigation(); return }
      const known = new Set(current.entries.map(projectBindingKey))
      const added = projects.filter(project => !known.has(projectBindingKey(project.binding)))
      if (!current.initialized) {
        await save({ ...initializeProjectNavigation(projects), revision: current.revision })
      } else if (added.length) {
        const entries = [...current.entries, ...added.map((project, index) => ({ ...project.binding, groupId: newGroup.current && !newGroup.current.existing.has(projectBindingKey(project.binding)) ? newGroup.current.groupId : null, sortOrder: current.entries.length + index }))]
        newGroup.current = null
        await save({ ...current, entries })
      } else { setNav(current); setNavError(null) }
    }).catch(error => { if (live) setNavError(learningError(error)) })
    return () => { live = false }
  }, [projects, loading, error, syncEpoch])
  const mutate = (next: ProjectNavigation): void => { void save(next).catch(error => showToast(learningError(error), 'danger')) }
  const toggle = (id: string): void => setCollapsed(current => { const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id]; try { localStorage.setItem('bandal:project-groups-collapsed', JSON.stringify(next)) } catch { /* Optional preference. */ } return next })
  const create = (groupId: string | null): void => { newGroup.current = { groupId, existing: new Set(projects.map(project => projectBindingKey(project.binding))) }; setAddOpen(false); setCreating(true) }
  const visible = projects.filter(project => !project.deletedAt && `${learningDisplayName(project, courses)} ${project.topic}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const byKey = new Map(visible.map(project => [projectBindingKey(project.binding), project]))
  const rows = (groupId: string | null): LearningProjectSummary[] => nav?.entries.filter(entry => entry.groupId === groupId).flatMap(entry => { const project = byKey.get(projectBindingKey(entry)); return project ? [project] : [] }) ?? []
  const drop = (groupId: string | null, before?: string): void => {
    if (!nav || !dragging) return
    if (dragging.kind === 'project') mutate(moveProject(nav, dragging.key, groupId, before))
    else if (groupId && dragging.key !== groupId) {
      const moved = nav.groups.find(group => group.id === dragging.key)
      if (moved) { const groups = nav.groups.filter(group => group.id !== moved.id); groups.splice(groups.findIndex(group => group.id === groupId), 0, moved); mutate({ ...nav, groups }) }
    }
    setDragging(null); setDropTarget(null)
  }
  const renderRow = (project: LearningProjectSummary): JSX.Element => {
    const key = projectBindingKey(project.binding)
    const selected = workspace?.kind === 'project' && workspace.courseId === project.binding.courseId && workspace.rootRelPath === project.binding.rootRelPath
    const entry = nav?.entries.find(item => projectBindingKey(item) === key)
    const name = learningDisplayName(project, courses)
    const projectHover = hover.rowProps(workspaceKey({ kind: 'project', ...project.binding }), true)
    return <li key={key}><div className="project-list-row" data-selected={selected || undefined} data-drop-before={dropTarget === key || undefined} draggable={!query} onDragStart={event => { event.dataTransfer.setData(DRAG, key); event.dataTransfer.effectAllowed = 'move'; setDragging({ kind: 'project', key }) }} onDragEnd={() => { setDragging(null); setDropTarget(null) }} onDragEnter={projectHover.onDragEnter} onDragOver={event => { projectHover.onDragOver?.(event); if (event.defaultPrevented || dragging?.kind !== 'project') return; event.preventDefault(); event.stopPropagation(); setDropTarget(key) }} onDrop={event => { projectHover.onDrop?.(event); if (event.defaultPrevented || !dragging) return; event.preventDefault(); event.stopPropagation(); drop(entry?.groupId ?? null, key) }}>
      <button type="button" className="course-row__toggle" aria-label={`${name} ${expanded.includes(key) ? '접기' : '펼치기'}`} aria-expanded={expanded.includes(key)} onClick={() => toggleProject(key)}><Icon name="chevronRight" /></button>
      <button type="button" className="project-list-row__open" aria-current={selected ? 'page' : undefined} onClick={() => openLearning(project.binding)}><Icon name="folder" /><span><strong>{name}</strong><small>{project.purpose === 'english-reading' ? '영어 읽기' : project.purpose === 'course-review' ? '과목 복습' : '종류 확인 필요'}{project.dueCardCount ? ` · 복습 ${project.dueCardCount}` : ''}</small></span></button>
      <LearningSpaceMenu project={project} groups={nav?.groups ?? []} groupId={entry?.groupId ?? null} onMoveGroup={groupId => { if (nav) mutate(moveProject(nav, key, groupId)) }} />
    </div>{expanded.includes(key) && <ProjectFolderContents binding={project.binding} />}</li>
  }
  return <aside id="learning-spaces-panel" className="app-rail app-rail--left course-sidebar project-sidebar" aria-label="프로젝트 목록" hidden={hidden}>
    <header className="rail-heading"><HomeTabs /><div className="project-add"><button className="bare-icon-button" type="button" aria-label="프로젝트 추가" data-tour="project-add" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen(value => !value)}><Icon name="plus" /></button>{addOpen && <div ref={menu} role="menu" className="project-menu"><button role="menuitem" onClick={() => create(null)}>새 프로젝트</button><button role="menuitem" onClick={() => { setAddOpen(false); setGroupDialog('new') }}>새 그룹</button><button role="menuitem" onClick={() => { setAddOpen(false); void reload(); loadNavigation() }}>새로고침</button><button role="menuitem" onClick={() => { setAddOpen(false); setShowDeleted(value => !value) }}>삭제한 프로젝트</button></div>}</div></header>
    <label className="rail-search"><Icon name="search" className="rail-search__icon" /><input type="search" aria-label="프로젝트 검색" placeholder="프로젝트 찾기" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {(error || navError) && <div className="rail-error" role="alert"><span>{error || navError}</span><button onClick={() => { void reload(); loadNavigation() }}>다시 시도</button></div>}
    <div className="app-rail__body project-list" onDragOver={event => { if (dragging?.kind === 'project') event.preventDefault() }} onDrop={event => { if (event.target === event.currentTarget) { event.preventDefault(); drop(null) } }}>
      {(loading || !nav) && <p role="status" className="learning-muted">프로젝트 불러오는 중…</p>}
      <ul className="project-ungrouped" aria-label="그룹 없는 프로젝트" onDragOver={event => { if (dragging?.kind === 'project') { event.preventDefault(); setDropTarget('ungrouped') } }} onDrop={event => { event.preventDefault(); event.stopPropagation(); drop(null) }} data-drop-into={dropTarget === 'ungrouped' || undefined}>{rows(null).map(renderRow)}</ul>
      {nav?.groups.map(group => {
        const items = rows(group.id)
        if (query && !items.length) return null
        const closed = !query && collapsed.includes(group.id)
        return <section className="project-group" key={group.id} aria-label={group.name}>
          <div className="project-group__header" draggable={!query} onDragStart={event => { event.dataTransfer.setData(DRAG, group.id); setDragging({ kind: 'group', key: group.id }) }} onDragEnd={() => { setDragging(null); setDropTarget(null) }} onDragOver={event => { if (dragging) { event.preventDefault(); setDropTarget(group.id) } }} onDrop={event => { event.preventDefault(); event.stopPropagation(); drop(group.id) }} data-drop-into={dropTarget === group.id || undefined}>
            <button className="project-group__toggle" aria-expanded={!closed} onClick={() => toggle(group.id)}><Icon name="chevronRight" /><span>{group.name}</span><small>{items.length}</small></button>
            <ProjectGroupMenu name={group.name} onCreate={() => create(group.id)} onRename={() => setGroupDialog(group)} onDelete={() => setDeleteGroup(group)} />
          </div>
          {!closed && <ul>{items.map(renderRow)}{!items.length && <li className="project-group__empty">프로젝트를 끌어다 놓으세요</li>}</ul>}
        </section>
      })}
      {!loading && nav && !visible.length && <p className="project-group__empty">{query ? '검색한 프로젝트가 없어요.' : '프로젝트를 추가해 시작하세요.'}</p>}
      {showDeleted && <section className="project-deleted"><h3>삭제한 프로젝트</h3>{projects.filter(project => project.deletedAt).map(project => <div key={projectBindingKey(project.binding)}><span>{learningDisplayName(project, courses)}</span><button onClick={() => { void restoreLearningSpace(project).then(reload).catch(error => showToast(learningError(error), 'danger')) }}>복원</button></div>)}</section>}
    </div>
    {creating && <NewLearningDialog onStart={() => setCreating(false)} onClose={() => { newGroup.current = null; setCreating(false) }} />}
    {groupDialog && createPortal(<CourseGroupNameDialog open mode={groupDialog === 'new' ? 'create' : 'rename'} initialName={groupDialog === 'new' ? '' : groupDialog.name} onClose={() => setGroupDialog(null)} onSubmit={async name => { if (!nav) return; const groups = groupDialog === 'new' ? [...nav.groups, { id: crypto.randomUUID(), name, sortOrder: nav.groups.length }] : nav.groups.map(group => group.id === groupDialog.id ? { ...group, name } : group); await save({ ...nav, groups }) }} />, document.body)}
    {deleteGroup && createPortal(<DeleteCourseGroupDialog groupName={deleteGroup.name} onClose={() => setDeleteGroup(null)} onConfirm={async () => { if (!nav) return; await save({ ...nav, groups: nav.groups.filter(group => group.id !== deleteGroup.id), entries: nav.entries.map(entry => entry.groupId === deleteGroup.id ? { ...entry, groupId: null } : entry) }) }} />, document.body)}
  </aside>
}
