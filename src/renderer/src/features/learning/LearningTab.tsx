import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { isTabDescriptor, type LearningTabPayload, type LearningView } from '../../../../shared/tabs'
import type { LearningArticleSnapshot, LearningArtifact, LearningDraft, LearningProjectSnapshot, LearningRunKind } from '../../../../shared/types/learning'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { invoke, onPush } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { MarkdownView } from '../chat/MarkdownView'
import { usePanelActive } from '../workspace/usePanelActive'
import { LearningProjectsHome } from './LearningProjects'
import { LearningReader } from './LearningReader'
import { LearningQuiz, LearningCards, dueLearningCards } from './LearningReview'
import { LearningSources } from './LearningSources'
import { LearningDraftPreview } from './LearningDraftPreview'
import { LearningMaterialImportDialog } from './LearningMaterialImportDialog'
import { learningError, notifyLearningChanged } from './learningNavigation'
import { filterLearningArticles, learningProgressMetrics, type LearningArticleFilter, type LearningArticleDateFilter } from './learningMetrics'
import { findMovedLearningBinding, rebindLearningPanel } from './learningRelocation'
import './learning.css'

const NAVIGATION: { view: LearningView; label: string; symbol: string }[] = [
  { view: 'home', label: '오늘의 학습', symbol: '◒' }, { view: 'reader', label: '읽기', symbol: 'Aa' },
  { view: 'vocabulary', label: '나의 단어', symbol: 'W' }, { view: 'articles', label: '읽은 글과 다음 글', symbol: '↗' },
  { view: 'review', label: '퀴즈 · 카드', symbol: '▤' }
]
const RUN_LABELS: Record<LearningRunKind, string> = { 'find-articles': '다음 글 찾기', 'explain-word': '문맥 속 뜻 정리', 'create-quiz': '퀴즈 만들기', 'create-cards': '플래시카드 만들기', 'create-summary': '학습 자료 정리', 'import-material': '기존 자료 변환' }

function markdownFiles(nodes: MaterialNode[]): MaterialNode[] {
  return nodes.flatMap(node => node.kind === 'dir' ? markdownFiles(node.children ?? []) : /\.md$/i.test(node.relPath) ? [node] : [])
}

export default function LearningTab(props: IDockviewPanelProps): JSX.Element {
  const raw = props.params.descriptor
  if (!isTabDescriptor(raw) || raw.kind !== 'learning') return <p className="learning-error">학습 공간 정보를 찾을 수 없어요.</p>
  return raw.payload.rootRelPath === undefined ? <LearningProjectsHome courseId={raw.payload.courseId} /> : <LearningProjectTab {...props} payload={raw.payload} />
}

function LearningProjectTab({ payload, ...props }: IDockviewPanelProps & { payload: LearningTabPayload }): JSX.Element {
  const binding = { courseId: payload.courseId, rootRelPath: payload.rootRelPath! }
  const active = usePanelActive(props.api)
  const [project, setProject] = useState<LearningProjectSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<LearningView>(payload.view ?? 'home')
  const [itemId, setItemId] = useState<string | undefined>(payload.itemId)
  const [article, setArticle] = useState<LearningArticleSnapshot | null>(null)
  const [artifact, setArtifact] = useState<LearningArtifact | null>(null)
  const [articleLoading, setArticleLoading] = useState(false)
  const [artifactLoading, setArtifactLoading] = useState(false)
  const contentLoading = articleLoading || artifactLoading
  const [pending, setPending] = useState(false)
  const [url, setUrl] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importFiles, setImportFiles] = useState<MaterialNode[]>([])
  const [importPath, setImportPath] = useState('')
  const [wordQuery, setWordQuery] = useState('')
  const [articleFilter, setArticleFilter] = useState<LearningArticleFilter>('all')
  const [articleDateFilter, setArticleDateFilter] = useState<LearningArticleDateFilter>('all')
  const [wordFilter, setWordFilter] = useState<'all' | 'new' | 'learning' | 'known'>('all')
  const sequence = useRef(0)
  const projectId = useRef(payload.projectId)
  const currentPayload = useRef(payload); currentPayload.current = payload
  const update = useCallback((next: LearningProjectSnapshot) => {
    projectId.current = next.projectId
    setProject(current => current && current.revision > next.revision ? current : next)
  }, [])
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    try { const next = await invoke('learning:get', { binding: { courseId: payload.courseId, rootRelPath: payload.rootRelPath! } }); if (request === sequence.current) { update(next); setError(null) } }
    catch (caught) {
      if (projectId.current) {
        try {
          const result = await invoke('learning:list', { courseId: payload.courseId })
          const moved = findMovedLearningBinding(binding, projectId.current, result.projects)
          if (moved && request === sequence.current) { rebindLearningPanel(props, { ...currentPayload.current, ...moved, projectId: projectId.current }); return }
        } catch { /* Retain the original error when rediscovery is unavailable. */ }
      }
      if (request === sequence.current) setError(learningError(caught))
    }
    finally { if (request === sequence.current) setLoading(false) }
  }, [payload.courseId, payload.rootRelPath, update])

  useEffect(() => {
    setLoading(true); setProject(null); void refresh()
    const stop = onPush('learning:changed', event => { if (event.binding.courseId === binding.courseId) void refresh() })
    const stopMaterials = onPush('materials:changed', event => { if (event.courseId === binding.courseId) void refresh() })
    return () => { sequence.current += 1; stop(); stopMaterials() }
  }, [refresh])
  useEffect(() => {
    if (project && payload.projectId !== project.projectId) { props.api.updateParameters({ descriptor: { kind: 'learning', payload: { ...payload, projectId: project.projectId } } }); useWorkspaceStore.getState().notifyLayoutChanged() }
  }, [project?.projectId, payload.projectId])
  useEffect(() => { setView(payload.view ?? 'home'); setItemId(payload.itemId) }, [payload.view, payload.itemId])
  useEffect(() => { if (project) props.api.setTitle(project.name) }, [project?.name, props.api])
  const running = project?.runs.some(run => ['queued', 'running', 'validating'].includes(run.status)) ?? false
  useEffect(() => { if (!active || !running) return; const timer = setInterval(() => void refresh(), 2500); return () => clearInterval(timer) }, [active, running, refresh])

  const navigate = (nextView: LearningView, nextItem?: string): void => {
    setView(nextView); setItemId(nextItem); setError(null)
    props.api.updateParameters({ descriptor: { kind: 'learning', payload: { ...binding, ...(projectId.current ? { projectId: projectId.current } : {}), view: nextView, ...(nextItem ? { itemId: nextItem } : {}) } } })
    useWorkspaceStore.getState().notifyLayoutChanged()
  }
  const articleId = view === 'reader' ? itemId ?? project?.articles.find(item => item.status === 'reading')?.id ?? project?.articles.find(item => item.status === 'unread')?.id ?? project?.articles.at(-1)?.id : undefined
  useEffect(() => {
    if (!articleId) { setArticle(null); setArticleLoading(false); return }
    let cancelled = false; setArticleLoading(true); setArticle(null)
    void invoke('learning:getArticle', { binding, id: articleId }).then(next => { if (!cancelled) setArticle(next) }).catch(caught => { if (!cancelled) setError(learningError(caught)) }).finally(() => { if (!cancelled) setArticleLoading(false) })
    return () => { cancelled = true }
  }, [articleId, binding.courseId, binding.rootRelPath])
  const artifactId = view === 'review' ? itemId : undefined
  useEffect(() => {
    if (!artifactId) { setArtifact(null); setArtifactLoading(false); return }
    let cancelled = false; setArtifactLoading(true); setArtifact(null)
    void invoke('learning:getArtifact', { binding, id: artifactId }).then(next => { if (!cancelled) setArtifact(next) }).catch(caught => { if (!cancelled) setError(learningError(caught)) }).finally(() => { if (!cancelled) setArtifactLoading(false) })
    return () => { cancelled = true }
  }, [artifactId, binding.courseId, binding.rootRelPath])

  const perform = async (action: () => Promise<unknown>): Promise<void> => { setPending(true); setError(null); try { await action(); await refresh(); notifyLearningChanged() } catch (caught) { setError(learningError(caught)) } finally { setPending(false) } }
  const run = (kind: LearningRunKind, sourceArticleIds?: string[], sourceWordIds?: string[]): void => { void perform(() => invoke('learning:run', { binding, kind, ...(sourceArticleIds ? { articleIds: sourceArticleIds } : {}), ...(sourceWordIds ? { wordIds: sourceWordIds } : {}) })) }
  const startImport = async (): Promise<void> => { setShowImport(true); try { const tree = await invoke('materials:tree', { courseId: binding.courseId }); setImportFiles(markdownFiles(tree)) } catch (caught) { setError(learningError(caught)) } }
  const importSave = (draft: LearningDraft, runId: string): void => { void perform(async () => { update(await invoke('learning:importSave', { binding, draft, runId })); navigate(draft.words?.length && !draft.artifacts?.length ? 'vocabulary' : 'review') }) }
  if (loading) return <div className="learning-panel learning-centered" role="status">학습 공간 불러오는 중…</div>
  if (!project) return <div className="learning-panel learning-page"><p className="learning-error" role="alert">{error ?? '학습 자료를 찾을 수 없어요.'}</p><button className="button button--secondary" type="button" onClick={() => void refresh()}>다시 불러오기</button></div>
  const nextArticle = project.articles.find(item => item.status === 'reading') ?? project.articles.find(item => item.status === 'unread')
  const due = dueLearningCards(project)
  const metrics = learningProgressMetrics(project)
  const displayedArticles = filterLearningArticles(project.articles, articleFilter, articleDateFilter)
  const displayedWords = project.words.filter(word => (wordFilter === 'all' || word.status === wordFilter) && `${word.surface} ${word.lemma} ${word.meaning}`.toLowerCase().includes(wordQuery.toLowerCase()))
  const previewRuns = project.runs.filter(run => run.status === 'awaiting-confirmation' && run.draft)

  return <div className="learning-panel">
    <header className="learning-topbar"><div><span className="learning-project-dot" /><strong>{project.name}</strong><span className="learning-topbar-topic">{project.topic}</span></div><button className="learning-text-button" type="button" disabled={pending} onClick={() => void startImport()}><Icon name="fileText" /> 기존 자료 가져오기</button></header>
    <nav className="learning-navigation" aria-label="학습 화면">{NAVIGATION.map(item => <button key={item.view} type="button" aria-current={view === item.view ? 'page' : undefined} onClick={() => navigate(item.view)}><span aria-hidden="true">{item.symbol}</span>{item.label}{item.view === 'review' && due.length > 0 && <small>{due.length}</small>}</button>)}</nav>
    {error && <div className="learning-error learning-error-banner" role="alert"><span>{error}</span><button className="learning-text-button" type="button" onClick={() => setError(null)}>닫기</button></div>}
    {project.warnings.length > 0 && <div className="learning-notice" role="status">{project.warnings.join(' ')}</div>}
    {project.runs.filter(item => item.status !== 'complete').slice(-4).map(item => <div className="learning-run" key={item.id} role="status" data-status={item.status}><span className="learning-run-indicator" /><div><strong>{RUN_LABELS[item.kind]}</strong><span>{item.error ?? item.message ?? (item.status === 'validating' ? '원문과 결과를 확인하고 있어요.' : '학습 자료를 준비하고 있어요.')}</span></div>{['failed', 'interrupted', 'cancelled'].includes(item.status) ? <button type="button" className="learning-text-button" disabled={pending} onClick={() => void perform(() => invoke('learning:runRetry', { binding, runId: item.id }))}>다시 시도</button> : <button type="button" className="learning-text-button" disabled={pending} onClick={() => void perform(async () => update(await invoke('learning:runCancel', { binding, runId: item.id })))}>취소</button>}</div>)}
    {previewRuns.length > 0 ? <div className="learning-content-scroll"><div className="learning-page">{previewRuns.map(item => <LearningDraftPreview key={item.id} run={item} pending={pending} onSave={draft => importSave(draft, item.id)} onCancel={() => void perform(async () => update(await invoke('learning:runCancel', { binding, runId: item.id })))} />)}</div></div> : view === 'reader' && article ? <LearningReader project={project} article={article} onUpdate={update} onComplete={() => navigate('articles')} onArticle={id => navigate('reader', id)} /> : <div className="learning-content-scroll"><div className="learning-page">
      {contentLoading ? <p role="status" className="learning-muted">자료 불러오는 중…</p> : view === 'home' ? <>
        <div className="learning-hero"><div><p className="learning-eyebrow">ONE ARTICLE AT A TIME</p><h1>{project.articles.length === 0 ? '좋아하는 이야기로 시작해요.' : '다음 문장에서 다시 만나요.'}</h1><p className="learning-lead">{project.topic ? `${project.topic}에 관한 짧은 글을 읽으며, 나만의 단어와 예문을 쌓아가요.` : '나의 자료로 만든 퀴즈와 카드로 조금씩 복습해요.'}</p><button type="button" className="button button--primary" disabled={pending || (!nextArticle && running)} onClick={() => nextArticle ? navigate('reader', nextArticle.id) : run('find-articles')}>{nextArticle ? '이어서 읽기' : '첫 영어 글 찾기'} <Icon name="chevronRight" /></button></div><div className="learning-hero-orbit" aria-hidden="true"><span>Aa</span><small>READ · REMEMBER · REPEAT</small></div></div>
        <div className="learning-stats"><button type="button" onClick={() => navigate('articles')}><strong>{project.articles.filter(item => item.status === 'completed').length}</strong><span>읽은 글</span></button><button type="button" onClick={() => navigate('vocabulary')}><strong>{project.words.length}</strong><span>나의 단어</span></button><button type="button" onClick={() => navigate('vocabulary')}><strong>{project.words.filter(item => item.status === 'known').length}</strong><span>익숙해진 단어</span></button><button type="button" onClick={() => navigate('review')}><strong>{due.length}</strong><span>오늘의 복습 카드</span></button></div>
        <div className="learning-insights"><div><strong>{metrics.encounteredWordCount}</strong><span>읽은 다른 글에서 다시 만난 단어</span></div><div><strong>{metrics.reviewedCardCount}</strong><span>복습한 카드</span></div>{metrics.latestQuiz && <div><strong>{metrics.latestQuiz.score} / {metrics.latestQuiz.total}</strong><span>최근 퀴즈 자동 채점 · 단답형 {metrics.latestQuiz.selfPassedCount} / {metrics.latestQuiz.selfCheckedCount}</span></div>}</div>
        {nextArticle && <button className="learning-next-article" type="button" onClick={() => navigate('reader', nextArticle.id)}><div><p className="learning-eyebrow">{nextArticle.status === 'reading' ? 'CONTINUE READING' : 'UP NEXT'}</p><h2>{nextArticle.title}</h2><span>약 {nextArticle.estimatedMinutes}분 · 내 단어 {nextArticle.matchedWordIds.length}개 다시 만나기</span></div><Icon name="chevronRight" /></button>}
        <div className="learning-section-heading"><h2>쌓여가는 학습 기록</h2><button className="learning-text-button" type="button" disabled={pending || running || project.words.length === 0} onClick={() => run('create-summary', undefined, project.words.map(word => word.id))}>단어와 예문 정리하기</button></div><ol className="learning-history">{project.history.slice(-8).reverse().map(item => <li key={item.id}><span>{item.summary}</span><time>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</time></li>)}</ol>{project.history.length === 0 && <p className="learning-muted">첫 글을 읽으면 나의 학습 기록이 이곳에 쌓입니다.</p>}
      </> : view === 'articles' || view === 'reader' ? <><div className="learning-section-heading"><div><p className="learning-eyebrow">YOUR READING JOURNEY</p><h1>읽은 글과 다음 글</h1></div><button className="button button--primary" type="button" disabled={pending || running} onClick={() => run('find-articles')}>다음 글 찾기</button></div><p className="learning-muted">관심 주제와 내 단어가 실제로 등장하는 문장을 함께 확인해 글을 찾아요.</p><div className="learning-vocabulary-filter"><select aria-label="글 상태" value={articleFilter} onChange={event => setArticleFilter(event.target.value as LearningArticleFilter)}><option value="all">모든 글</option><option value="unread">읽기 전</option><option value="reading">읽는 중</option><option value="completed">읽은 글</option></select><select aria-label="글 기록 기간" value={articleDateFilter} onChange={event => setArticleDateFilter(event.target.value as LearningArticleDateFilter)}><option value="all">전체 기간</option><option value="week">최근 7일</option><option value="month">최근 30일</option></select></div><form className="learning-url-form" onSubmit={event => { event.preventDefault(); void perform(async () => { update(await invoke('learning:addArticle', { binding, url })); setUrl('') }) }}><label className="sr-only" htmlFor={`${props.api.id}-article-url`}>직접 추가할 기사 주소</label><input id={`${props.api.id}-article-url`} className="text-field" type="url" placeholder="읽고 싶은 영어 글의 주소를 붙여넣으세요" value={url} onChange={event => setUrl(event.target.value)} required /><button className="button button--secondary" type="submit" disabled={pending || !url.trim()}>글 추가</button></form><div className="learning-article-list">{displayedArticles.map(item => <button type="button" key={item.id} className="learning-article-card" onClick={() => navigate('reader', item.id)}><div className="learning-article-card__status" data-status={item.status}>{item.status === 'completed' ? '읽음' : item.status === 'reading' ? '읽는 중' : '다음 글'}</div><h2>{item.title}</h2><span>{new URL(item.sourceUrl).hostname} · 약 {item.estimatedMinutes}분</span><small>내 단어 {item.matchedWordIds.length}개 다시 만나기</small></button>)}</div>{displayedArticles.length === 0 && <div className="learning-empty">{project.articles.length ? '선택한 조건에 맞는 글이 없어요.' : '아직 글이 없어요.'}<p>AI가 첫 글을 찾게 하거나 직접 주소를 추가하세요.</p></div>}</> : view === 'vocabulary' ? <><div className="learning-section-heading"><div><p className="learning-eyebrow">A WORD, MANY CONTEXTS</p><h1>나의 단어</h1></div><span className="learning-pill">{project.words.length}개</span></div><div className="learning-vocabulary-filter"><input className="text-field" type="search" aria-label="단어 검색" placeholder="단어나 뜻 찾기" value={wordQuery} onChange={event => setWordQuery(event.target.value)} /><select value={wordFilter} aria-label="단어 상태" onChange={event => setWordFilter(event.target.value as typeof wordFilter)}><option value="all">모든 단어</option><option value="new">처음 만난 단어</option><option value="learning">공부 중</option><option value="known">익숙한 단어</option></select></div><div className="learning-vocabulary-list">{displayedWords.map(word => <details key={word.id} className="learning-vocabulary-word"><summary><div><strong>{word.surface}</strong>{word.lemma !== word.surface && <small>{word.lemma}</small>}<span>{word.meaning || '문맥 속 뜻을 정리하는 중'}</span></div><span className="learning-pill">{word.status === 'known' ? '익숙함' : word.status === 'learning' ? '공부 중' : '새 단어'} · {project.occurrences.filter(item => item.wordId === word.id).length}개 문맥</span></summary><div className="learning-vocabulary-detail"><p className="learning-muted">{[word.pronunciation, word.partOfSpeech].filter(Boolean).join(' · ')}</p><form className="learning-word-edit" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(async () => update(await invoke('learning:updateWord', { binding, wordId: word.id, lemma: String(form.get('lemma') ?? ''), partOfSpeech: String(form.get('partOfSpeech') ?? ''), meaning: String(form.get('meaning') ?? '') }))) }}><label className="learning-field"><span>원형·표현</span><input className="text-field" name="lemma" defaultValue={word.lemma} required /></label><label className="learning-field"><span>품사</span><input className="text-field" name="partOfSpeech" defaultValue={word.partOfSpeech} placeholder="예: noun, verb" /></label><label className="learning-field"><span>나의 뜻 정리</span><input className="text-field" name="meaning" defaultValue={word.meaning} /></label><button className="button button--secondary" type="submit" disabled={pending}>저장</button></form><div className="learning-word-status-actions" aria-label={`${word.surface} 학습 상태`}>{(['new', 'learning', 'known'] as const).map(status => <button type="button" className="button button--secondary" aria-pressed={word.status === status} disabled={pending} key={status} onClick={() => void perform(async () => update(await invoke('learning:updateWord', { binding, wordId: word.id, status })))}>{status === 'known' ? '이제 알아요' : status === 'learning' ? '공부 중' : '아직 몰라요'}</button>)}</div>{project.occurrences.filter(item => item.wordId === word.id).map(occurrence => <blockquote className="learning-word-example" key={occurrence.id}><p>{occurrence.sentence}</p><form className="learning-occurrence-edit" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(async () => update(await invoke('learning:updateOccurrence', { binding, occurrenceId: occurrence.id, meaning: String(form.get('meaning') ?? '') }))) }}><label className="learning-field"><span>이 문장에서 쓰인 뜻</span><input className="text-field" name="meaning" defaultValue={occurrence.meaning} /></label><button className="learning-text-button" type="submit" disabled={pending}>예문 뜻 저장</button></form><LearningSources sources={[occurrence.sourceRef]} binding={binding} onArticle={id => navigate('reader', id)} /></blockquote>)}</div></details>)}</div>{displayedWords.length === 0 && <div className="learning-empty">{project.words.length ? '일치하는 단어가 없어요.' : '읽기 화면에서 모르는 단어를 담아보세요.'}</div>}</> : view === 'review' ? artifact ? artifact.kind === 'quiz' ? <LearningQuiz key={artifact.id} artifact={artifact} project={project} onUpdate={update} onArticle={id => navigate('reader', id)} /> : artifact.kind === 'cards' ? <LearningCards key={artifact.id} artifact={artifact} project={project} onUpdate={update} onArticle={id => navigate('reader', id)} /> : <><h1>{artifact.title}</h1><MarkdownView text={artifact.markdown} /><LearningSources sources={artifact.sourceRefs} binding={binding} onArticle={id => navigate('reader', id)} /></> : <><div className="learning-section-heading"><div><p className="learning-eyebrow">REVIEW WHEN YOU WANT</p><h1>퀴즈와 플래시카드</h1></div><span className="learning-pill">오늘의 카드 {due.length}</span></div><p className="learning-muted">나의 단어와 원문 예문으로 확인해요. 읽기를 이어가다가, 원할 때 복습하세요.</p><div className="learning-form-row"><button type="button" className="button button--primary" disabled={pending || running || project.words.length === 0} onClick={() => run('create-quiz', undefined, project.words.map(word => word.id))}>내 단어로 퀴즈 만들기</button><button type="button" className="button button--secondary" disabled={pending || running || project.words.length === 0} onClick={() => run('create-cards', undefined, project.words.map(word => word.id))}>내 단어로 카드 만들기</button></div><div className="learning-artifact-list">{[...project.artifacts].reverse().map(item => <button className="learning-artifact-card" type="button" key={item.id} onClick={() => navigate('review', item.id)}><span className="learning-artifact-symbol">{item.kind === 'quiz' ? '?' : item.kind === 'cards' ? '▤' : 'Aa'}</span><div><strong>{item.title}</strong><span>{item.kind === 'quiz' ? '퀴즈 풀기' : item.kind === 'cards' ? '플래시카드 복습' : '단어와 예문 정리'}</span></div><Icon name="chevronRight" /></button>)}</div>{project.artifacts.length === 0 && <div className="learning-empty">아직 복습 자료가 없어요.<p>단어를 모아 만들거나, 기존 자료의 AI 학습 도구에서 퀴즈와 카드를 만들어 보세요.</p></div>}</> : null}
    </div></div>}
    {showImport && <LearningMaterialImportDialog files={importFiles} relPath={importPath} pending={pending} onSelect={setImportPath} onClose={() => setShowImport(false)} onPreview={() => void perform(async () => { await invoke('learning:importPreview', { binding, relPath: importPath }); setShowImport(false) })} />}
  </div>
}
