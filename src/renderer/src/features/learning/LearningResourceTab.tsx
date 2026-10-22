import { useEffect, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { isTabDescriptor, type LearningResourcePayload } from '../../../../shared/tabs'
import type { LearningArtifact, LearningArticleSnapshot, LearningProjectSnapshot } from '../../../../shared/types/learning'
import { invoke } from '../../lib/ipc'
import { MarkdownView } from '../chat/MarkdownView'
import { usePanelActive } from '../workspace/usePanelActive'
import { usePanelVisible } from '../workspace/usePanelVisible'
import { useWorkspacePlacement } from '../workspace/placementContext'
import { LearningReader } from './LearningReader'
import { LearningQuiz, LearningCards } from './LearningReview'
import { LearningSources } from './LearningSources'
import { learningError, openLearningResource } from './learningNavigation'
import { refreshLearningProject, updateLearningProjectSnapshot, useLearningProject } from './useLearningProject'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import './learning.css'

export default function LearningResourceTab(props: IDockviewPanelProps): JSX.Element {
  const descriptor = props.params.descriptor
  if (!isTabDescriptor(descriptor) || descriptor.kind !== 'learning-resource') return <p role="alert">자료 정보를 찾을 수 없어요.</p>
  return <ResourcePanel {...props} payload={descriptor.payload} />
}
function ResourcePanel({ payload, ...props }: IDockviewPanelProps & { payload: LearningResourcePayload }): JSX.Element {
  const binding = { courseId: payload.courseId, rootRelPath: payload.rootRelPath }
  const { project, loading, error } = useLearningProject(binding, payload.projectId)
  const active = usePanelActive(props.api)
  const visible = usePanelVisible(props.api)
  const placement = useWorkspacePlacement()
  const [article, setArticle] = useState<LearningArticleSnapshot | null>(null)
  const [artifact, setArtifact] = useState<LearningArtifact | null>(null)
  const [resourceError, setResourceError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const resource = payload.resource
  const resourceId = 'id' in resource ? resource.id : ''
  const contentHash = resource.kind === 'article' ? project?.articles.find(item => item.id === resourceId)?.contentHash : resource.kind === 'artifact' ? project?.artifacts.find(item => item.id === resourceId)?.contentHash : undefined
  const openArticle = (id: string): void => openLearningResource(binding, { kind: 'article', id }, placement?.workspace)
  useEffect(() => {
    let cancelled = false
    setArticle(null); setArtifact(null); setResourceError(null)
    if (resource.kind === 'vocabulary') return
    const request = resource.kind === 'article'
      ? invoke('learning:getArticle', { binding, id: resource.id }).then(next => { if (!cancelled) setArticle(next) })
      : invoke('learning:getArtifact', { binding, id: resource.id }).then(next => { if (!cancelled) setArtifact(next) })
    void request.catch(caught => { if (!cancelled) setResourceError(learningError(caught)) })
    return () => { cancelled = true }
  }, [payload.courseId, payload.rootRelPath, resource.kind, resourceId, contentHash, retry])
  useEffect(() => {
    if (project && payload.projectId !== project.projectId) {
      props.api.updateParameters({ descriptor: { kind: 'learning-resource', payload: { ...payload, projectId: project.projectId } } })
      useWorkspaceStore.getState().notifyLayoutChanged()
    }
  }, [project?.projectId, payload.projectId, props.api])
  useEffect(() => {
    const title = resource.kind === 'vocabulary' ? '단어장' : article?.title ?? artifact?.title
    if (title) props.api.setTitle(title)
  }, [resource.kind, article?.title, artifact?.title, props.api])
  if (loading) return <div className="workspace-panel-loading" role="status">자료 불러오는 중…</div>
  if (error || resourceError || !project) return <div className="learning-panel"><p className="learning-error" role="alert">{error ?? resourceError ?? '프로젝트를 찾을 수 없어요.'}</p><button type="button" className="button" onClick={() => { setRetry(value => value + 1); void refreshLearningProject(binding) }}>다시 불러오기</button></div>
  const onUpdate = updateLearningProjectSnapshot
  return <div className="learning-panel learning-resource-panel" data-learning-resource={resource.kind}>
    {project.warnings.length > 0 && <div className="learning-notice" role="status">{project.warnings.join(' ')}</div>}
    {resource.kind === 'article' ? article ? <LearningReader key={article.id} project={project} article={article} active={active} visible={visible} onUpdate={onUpdate} onComplete={() => {}} onArticle={openArticle} /> : <p role="status">글 불러오는 중…</p>
      : <div className="learning-content-scroll"><div className="learning-page">
        {resource.kind === 'vocabulary' ? <Vocabulary project={project} onArticle={openArticle} />
          : artifact ? artifact.kind === 'quiz' ? <LearningQuiz key={artifact.id} artifact={artifact} project={project} onUpdate={onUpdate} onArticle={openArticle} />
            : artifact.kind === 'cards' ? <LearningCards key={artifact.id} artifact={artifact} project={project} onUpdate={onUpdate} onArticle={openArticle} />
              : <><h1>{artifact.title}</h1><MarkdownView text={artifact.markdown} /><LearningSources sources={artifact.sourceRefs} binding={binding} onArticle={openArticle} /></>
            : <p role="status">자료 불러오는 중…</p>}
      </div></div>}
  </div>
}

function Vocabulary({ project, onArticle }: { project: LearningProjectSnapshot; onArticle: (id: string) => void }): JSX.Element {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all')
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null)
  const save = async (work: () => Promise<LearningProjectSnapshot>): Promise<void> => {
    setPending(true); setError(null)
    try { updateLearningProjectSnapshot(await work()) } catch (caught) { setError(learningError(caught)) } finally { setPending(false) }
  }
  const words = project.words.filter(word => (filter === 'all' || word.status === filter) && `${word.surface} ${word.lemma} ${word.meaning}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <><div className="learning-section-heading"><h1>단어장</h1><span className="learning-pill">{project.words.length}개</span></div>
    <div className="learning-vocabulary-filter"><input className="text-field" type="search" aria-label="단어 검색" placeholder="단어나 뜻 찾기" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="단어 상태" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">모든 단어</option><option value="new">처음 만난 단어</option><option value="learning">공부 중</option><option value="known">익숙한 단어</option></select></div>
    {error && <p className="learning-error" role="alert">{error}</p>}
    <div className="learning-vocabulary-list">{words.map(word => <details className="learning-vocabulary-word" key={word.id}><summary><div><strong>{word.surface}</strong>{word.lemma !== word.surface && <small>{word.lemma}</small>}<span>{word.meaning || '뜻을 아직 적지 않았어요'}</span></div><span className="learning-pill">{word.status === 'known' ? '익숙함' : word.status === 'learning' ? '공부 중' : '새 단어'}</span></summary>
      <div className="learning-vocabulary-detail"><p className="learning-muted">{[word.pronunciation, word.partOfSpeech].filter(Boolean).join(' · ')}</p><form className="learning-word-edit" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void save(() => invoke('learning:updateWord', { binding: project.binding, wordId: word.id, lemma: String(data.get('lemma') ?? ''), partOfSpeech: String(data.get('partOfSpeech') ?? ''), meaning: String(data.get('meaning') ?? '') })) }}><label className="learning-field"><span>원형·표현</span><input className="text-field" name="lemma" defaultValue={word.lemma} required /></label><label className="learning-field"><span>품사</span><input className="text-field" name="partOfSpeech" defaultValue={word.partOfSpeech} /></label><label className="learning-field"><span>나의 뜻 정리</span><input className="text-field" name="meaning" defaultValue={word.meaning} /></label><button className="button button--secondary" type="submit" disabled={pending}>저장</button></form>
        <div className="learning-word-status-actions" aria-label={`${word.surface} 학습 상태`}>{(['new', 'learning', 'known'] as const).map(status => <button className="button button--secondary" type="button" key={status} aria-pressed={word.status === status} disabled={pending} onClick={() => void save(() => invoke('learning:updateWord', { binding: project.binding, wordId: word.id, status }))}>{status === 'known' ? '이제 알아요' : status === 'learning' ? '공부 중' : '아직 몰라요'}</button>)}</div>
        {project.occurrences.filter(item => item.wordId === word.id).map(occurrence => <blockquote className="learning-word-example" key={occurrence.id}><p>{occurrence.sentence}</p><form className="learning-occurrence-edit" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void save(() => invoke('learning:updateOccurrence', { binding: project.binding, occurrenceId: occurrence.id, meaning: String(data.get('meaning') ?? '') })) }}><label className="learning-field"><span>이 문장에서 쓰인 뜻</span><input className="text-field" name="meaning" defaultValue={occurrence.meaning} /></label><button className="learning-text-button" type="submit" disabled={pending}>예문 뜻 저장</button></form><LearningSources sources={[occurrence.sourceRef]} binding={project.binding} onArticle={onArticle} /></blockquote>)}
      </div></details>)}</div>{!words.length && <div className="learning-empty">{project.words.length ? '일치하는 단어가 없어요.' : '글을 읽으며 모르는 단어를 담아보세요.'}</div>}
  </>
}
