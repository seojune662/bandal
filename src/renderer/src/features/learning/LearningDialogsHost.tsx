import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../app/icons'
import { invoke } from '../../lib/ipc'
import { useFocusTrap } from '../../components/useFocusTrap'
import { useCoursesStore } from '../../stores/coursesStore'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { LearningCreateDialog } from './LearningCreateDialog'
import { useLearningProjects } from './LearningProjects'
import { learningError, notifyLearningChanged, openLearning } from './learningNavigation'

const CREATE_EVENT = 'bandal:learning-create'
const IMPORT_EVENT = 'bandal:learning-import'
interface ArticleImportRequest { courseId: string; url: string; tabId?: string }

export function requestLearningCreation(courseId?: string): void {
  window.dispatchEvent(new CustomEvent(CREATE_EVENT, { detail: { courseId } }))
}
export function requestLearningArticleImport(input: ArticleImportRequest): void {
  window.dispatchEvent(new CustomEvent(IMPORT_EVENT, { detail: input }))
}

export function LearningDialogsHost(): JSX.Element | null {
  const [creating, setCreating] = useState<{ courseId?: string } | null>(null)
  const [importing, setImporting] = useState<ArticleImportRequest | null>(null)
  useEffect(() => {
    const create = (event: Event): void => { if (event instanceof CustomEvent) setCreating(event.detail as { courseId?: string }) }
    const importArticle = (event: Event): void => { if (event instanceof CustomEvent) setImporting(event.detail as ArticleImportRequest) }
    window.addEventListener(CREATE_EVENT, create); window.addEventListener(IMPORT_EVENT, importArticle)
    return () => { window.removeEventListener(CREATE_EVENT, create); window.removeEventListener(IMPORT_EVENT, importArticle) }
  }, [])
  useEffect(() => { if (!creating && !importing) return; return acquirePointerPassthrough() }, [creating, importing])
  return creating ? <LearningCreateDialog {...creating} onClose={() => setCreating(null)} /> : importing ? <ArticleImportDialog input={importing} onClose={() => setImporting(null)} /> : null
}

function ArticleImportDialog({ input, onClose }: { input: ArticleImportRequest; onClose: () => void }): JSX.Element {
  const { projects, loading } = useLearningProjects()
  const courses = useCoursesStore(state => state.courses)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const projectKey = (binding: { courseId: string; rootRelPath: string }): string => `${binding.courseId}:${binding.rootRelPath}`
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const root = useRef<HTMLElement>(null)
  useFocusTrap(root, { active: !creating, onEscape: pending ? undefined : onClose })
  const selected = selectedKey === null ? projects.find(project => project.binding.courseId === input.courseId) ?? projects[0] : projects.find(project => projectKey(project.binding) === selectedKey)
  const add = async (): Promise<void> => {
    if (!selected) return
    setPending(true); setError(null)
    try { const project = await invoke('learning:addArticle', { binding: selected.binding, url: input.url, ...(input.tabId ? { tabId: input.tabId } : {}) }); notifyLearningChanged(); const article = project.articles.find(item => item.sourceUrl === input.url) ?? project.articles.at(-1); openLearning(project.binding, 'reader', article?.id); onClose() }
    catch (caught) { setError(learningError(caught)); setPending(false) }
  }
  if (creating) return <LearningCreateDialog courseId={input.courseId} onCreated={binding => setSelectedKey(projectKey(binding))} onClose={() => setCreating(false)} />
  return createPortal(<div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !pending) onClose() }}><section ref={root} className="course-dialog learning-create" role="dialog" aria-modal="true" aria-label="기사를 학습에 추가"><header className="course-dialog__header"><div><p className="eyebrow">READ IT YOUR WAY</p><h2>이 글을 학습에 추가하기</h2></div><button className="bare-icon-button" type="button" aria-label="닫기" disabled={pending} onClick={onClose}><Icon name="x" /></button></header><p className="learning-muted">원문을 읽기 화면에 보관하고, 모르는 단어와 예문을 쌓아갈 수 있어요.</p><p className="learning-import-url">{input.url}</p>{loading ? <p role="status">학습 공간 불러오는 중…</p> : projects.length > 0 ? <label className="learning-field"><span>자료를 쌓을 학습 공간</span><select value={selected ? projectKey(selected.binding) : ''} disabled={pending} onChange={event => setSelectedKey(event.target.value)}>{projects.map(project => <option value={projectKey(project.binding)} key={projectKey(project.binding)}>{project.name}{project.binding.courseId !== input.courseId ? ` · ${courses.find(course => course.id === project.binding.courseId)?.name ?? '다른 과목'}` : ''}</option>)}</select></label> : <p className="learning-muted">먼저 이 글을 담을 학습 공간을 만들어 주세요.</p>}<button className="learning-text-button" type="button" disabled={pending} onClick={() => setCreating(true)}><Icon name="plus" /> 새 학습 공간 만들기</button>{error && <p className="learning-error" role="alert">{error}</p>}<footer className="dialog-actions"><button className="button button--secondary" type="button" disabled={pending} onClick={onClose}>취소</button><button className="button button--primary" type="button" disabled={pending || !selected} onClick={() => void add()}>{pending ? '글을 읽기 화면에 담는 중…' : '학습에 추가'}</button></footer></section></div>, document.body)
}
