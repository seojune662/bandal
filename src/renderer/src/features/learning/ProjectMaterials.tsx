import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LearningBinding } from '../../../../shared/types/learning'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useUiStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useFocusTrap } from '../../components/useFocusTrap'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { learningError, openLearningResource } from './learningNavigation'
import { LearningMaterialImportDialog } from './LearningMaterialImportDialog'
import { startLearningRun } from './learningStartedRuns'
import { LearningCreateDialog } from './LearningCreateDialog'
import { learningNeedsSettings } from './learningPurpose'
import { useLearningProject, refreshLearningProject } from './useLearningProject'
import { sameWorkspace } from '../../../../shared/types/workspace'

export const PROJECT_IMPORT_EVENT = 'bandal:project-import'
export function requestProjectImport(kind: 'url' | 'markdown'): void { window.dispatchEvent(new CustomEvent(PROJECT_IMPORT_EVENT, { detail: kind })) }
function markdowns(nodes: MaterialNode[]): MaterialNode[] { return nodes.flatMap(node => node.kind === 'dir' ? markdowns(node.children ?? []) : /\.md$/i.test(node.relPath) ? [node] : []) }

export function ProjectMaterials({ binding, query, onTitle }: { binding: LearningBinding; query: string; onTitle?: (title: string) => void }): JSX.Element {
  const { project, error } = useLearningProject(binding)
  const [urlOpen, setUrlOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [files, setFiles] = useState<MaterialNode[]>([])
  const [path, setPath] = useState('')
  const [pending, setPending] = useState(false)
  const refresh = (): Promise<void> => refreshLearningProject(binding)
  useEffect(() => { if (project) onTitle?.(project.name) }, [project?.name, onTitle])
  const revealAssistant = (): void => {
    if (sameWorkspace(useWorkspaceStore.getState().activeWorkspace, { kind: 'project', ...binding })) useUiStore.getState().showAssistant()
  }
  useEffect(() => {
    const listener = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === 'url') setUrlOpen(true)
      else { setImportOpen(true); const courseId = project?.linkedCourseId ?? binding.courseId; void invoke('materials:tree', { courseId }).then(result => setFiles(markdowns(result))).catch(error => showToast(learningError(error), 'danger')) }
    }
    window.addEventListener(PROJECT_IMPORT_EVENT, listener)
    return () => window.removeEventListener(PROJECT_IMPORT_EVENT, listener)
  }, [binding.courseId, project?.linkedCourseId])
  const perform = async (action: () => Promise<unknown>): Promise<void> => { if (pending) return; setPending(true); try { await action(); await refresh() } catch (error) { showToast(learningError(error), 'danger') } finally { setPending(false) } }
  const active = useWorkspaceStore(state => state.activeTabDescriptor())
  const normalized = query.trim().toLocaleLowerCase()
  const matches = (title: string): boolean => !normalized || title.toLocaleLowerCase().includes(normalized)
  const selected = (kind: string, id?: string): boolean => active?.kind === 'learning-resource' && active.payload.courseId === binding.courseId && active.payload.rootRelPath === binding.rootRelPath && active.payload.resource.kind === kind && (!id || 'id' in active.payload.resource && active.payload.resource.id === id)
  if (error) return <div className="rail-error" role="alert"><span>{error}</span><button onClick={() => void refresh()}>다시 시도</button></div>
  if (!project) return <p className="project-group__empty" role="status">프로젝트 자료 불러오는 중…</p>
  const resources = project.artifacts.filter(artifact => matches(artifact.title))
  const articles = project.articles.filter(article => matches(article.title))
  return <div className="project-materials">
    {project.purpose === 'english-reading' && <details open><summary>글 <small>{project.articles.length}</small></summary><ul>{articles.map(article => <li key={article.id}><button data-selected={selected('article', article.id) || undefined} onClick={() => openLearningResource(binding, { kind: 'article', id: article.id })}><Icon name="fileText" /><span>{article.title}</span>{article.status === 'completed' && <small>✓</small>}</button></li>)}</ul><button className="project-materials__action" disabled={pending} onClick={() => { if (learningNeedsSettings(project)) { setSettingsOpen(true); return }; void perform(async () => { await startLearningRun({ binding, kind: 'find-articles', ...(project.packId ? { packId: project.packId } : {}) }); revealAssistant() }) }}>다음 글 찾기</button></details>}
    {project.purpose === 'english-reading' && matches('단어장') && <button className="project-materials__resource" data-selected={selected('vocabulary') || undefined} onClick={() => openLearningResource(binding, { kind: 'vocabulary' })}><Icon name="fileText" /><span>단어장</span><small>{project.words.length}</small></button>}
    {(['quiz', 'cards', 'summary'] as const).map(kind => <details open key={kind}><summary>{kind === 'quiz' ? '퀴즈' : kind === 'cards' ? '플래시카드' : '요약'} <small>{project.artifacts.filter(item => item.kind === kind).length}</small></summary><ul>{resources.filter(item => item.kind === kind).map(artifact => <li key={artifact.id}><button data-selected={selected('artifact', artifact.id) || undefined} onClick={() => openLearningResource(binding, { kind: 'artifact', id: artifact.id })}><Icon name="fileText" /><span>{artifact.title}</span></button></li>)}</ul>{!resources.some(item => item.kind === kind) && <p className="project-group__empty">아직 자료가 없어요.</p>}</details>)}
    {urlOpen && <ProjectUrlDialog pending={pending} onClose={() => setUrlOpen(false)} onAdd={url => void perform(async () => { await invoke('learning:addArticle', { binding, url }); setUrlOpen(false) })} />}
    {importOpen && <LearningMaterialImportDialog files={files} relPath={path} pending={pending} onSelect={setPath} onClose={() => setImportOpen(false)} onPreview={() => void perform(async () => { await invoke('learning:importPreview', { binding, relPath: path, sourceCourseId: project.linkedCourseId ?? binding.courseId }); setImportOpen(false); revealAssistant() })} />}
    {settingsOpen && <LearningCreateDialog project={project} onClose={() => setSettingsOpen(false)} onCreated={() => { setSettingsOpen(false); void refresh() }} />}
  </div>
}
function ProjectUrlDialog({ pending, onClose, onAdd }: { pending: boolean; onClose(): void; onAdd(url: string): void }): JSX.Element {
  const [url, setUrl] = useState('')
  const root = useRef<HTMLElement>(null)
  useFocusTrap(root, { active: true, onEscape: pending ? undefined : onClose })
  useEffect(() => acquirePointerPassthrough(), [])
  return createPortal(<div className="dialog-backdrop"><section ref={root} className="course-dialog" role="dialog" aria-modal="true" aria-label="글 URL 가져오기"><h2>글 URL 가져오기</h2><form onSubmit={event => { event.preventDefault(); onAdd(url) }}><label className="learning-field"><span>웹 주소</span><input className="text-field" type="url" required autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" disabled={pending} /></label><footer className="dialog-actions"><button type="button" className="button button--secondary" disabled={pending} onClick={onClose}>취소</button><button className="button button--primary" disabled={pending || !url.trim()}>{pending ? '가져오는 중…' : '가져오기'}</button></footer></form></section></div>, document.body)
}
