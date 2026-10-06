import { startLearningRun } from './learningStartedRuns'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LearningArticleSnapshot, LearningProjectSnapshot } from '../../../../shared/types/learning'
import { showToast } from '../../app/toast'
import { Icon } from '../../app/icons'
import { createBrowserTab } from '../../app/tabCommands'
import { invoke } from '../../lib/ipc'
import { learningWordForSurface, readerVocabularyMatches, readerWordSelection, selectionInReader, type ReaderWordSelection } from './readerSelection'
import { learningError, notifyLearningChanged } from './learningNavigation'
import { LearningSources } from './LearningSources'

export function LearningReader({ project, article, onUpdate, onComplete, onArticle }: {
  project: LearningProjectSnapshot; article: LearningArticleSnapshot
  onUpdate: (project: LearningProjectSnapshot) => void; onComplete: () => void; onArticle: (id: string) => void
}): JSX.Element {
  const [selected, setSelected] = useState<ReaderWordSelection | null>(null)
  const [meaning, setMeaning] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progress = useRef<{ paragraphId: string | null; scrollFraction: number } | null>(null)
  const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate
  const readingPackId = project.purpose === 'english-reading' ? project.packId : undefined
  const saved = project.occurrences.filter(item => item.sourceRef.articleId === article.id)
  const matches = useMemo(() => new Map(article.paragraphs.map(paragraph => [paragraph.id, readerVocabularyMatches(paragraph.text, project.words)])), [article.paragraphs, project.words])
  const selectedWord = selected ? learningWordForSurface(project.words, selected.surface) : undefined
  const priorExamples = selectedWord ? project.occurrences.filter(item => item.wordId === selectedWord.id && item.sourceRef.articleId !== article.id) : []

  useEffect(() => {
    setSelected(null); setMeaning(''); setNotice(null); setError(null)
    const element = root.current
    const previous = project.articles.find(item => item.id === article.id)?.progress
    if (element && previous) element.scrollTop = previous.scrollFraction * Math.max(0, element.scrollHeight - element.clientHeight)
    const save = (): void => {
      if (!progress.current) return
      const value = progress.current; progress.current = null
      void invoke('learning:saveProgress', { binding: project.binding, articleId: article.id, ...value }).then(value => onUpdateRef.current(value)).catch(caught => setError(learningError(caught)))
    }
    return () => { if (progressTimer.current) clearTimeout(progressTimer.current); save() }
  }, [article.id, project.binding.courseId, project.binding.rootRelPath])

  const select = (value: ReaderWordSelection | null): void => { setSelected(value); setMeaning(''); setNotice(null) }
  const saveWord = async (): Promise<void> => {
    if (!selected) return
    setPending(true); setError(null)
    try {
      const next = await invoke('learning:saveWord', { binding: project.binding, ...selected,
        ...(selectedWord ? { lemma: selectedWord.lemma, ...(selectedWord.partOfSpeech ? { partOfSpeech: selectedWord.partOfSpeech } : {}) } : {}),
        ...(meaning.trim() ? { meaning: meaning.trim() } : {}) })
      onUpdate(next); notifyLearningChanged(); setNotice(`“${selected.surface}”을 단어장에 담았어요.`); setSelected(null)
      const occurrence = [...next.occurrences].reverse().find(item => item.sourceRef.articleId === article.id && item.surface === selected.surface)
      if (occurrence && !meaning.trim()) {
        const surface = selected.surface
        void startLearningRun({ binding: project.binding, kind: 'explain-word', ...(readingPackId ? { packId: readingPackId } : {}), articleIds: [article.id], wordIds: [occurrence.wordId] })
          .catch(() => setNotice(`“${surface}”은 단어장에 저장됐어요. 아래 문맥 설명 버튼으로 뜻 정리를 다시 시작할 수 있어요.`))
      }
    } catch (caught) { setError(learningError(caught)) }
    finally { setPending(false) }
  }
  const explain = async (wordId: string): Promise<void> => {
    setPending(true); setError(null)
    try { await startLearningRun({ binding: project.binding, kind: 'explain-word', ...(readingPackId ? { packId: readingPackId } : {}), articleIds: [article.id], wordIds: [wordId] }); setNotice('이 문장에서 쓰인 뜻과 표현을 정리하고 있어요.') }
    catch (caught) { setError(learningError(caught)) }
    finally { setPending(false) }
  }
  const complete = async (): Promise<void> => {
    setPending(true); setError(null)
    try {
      if (progressTimer.current) clearTimeout(progressTimer.current)
      progress.current = null
      const next = await invoke('learning:completeArticle', { binding: project.binding, articleId: article.id })
      onUpdate(next); notifyLearningChanged(); onComplete()
      if (project.purpose === 'english-reading' && project.readingSetupConfirmed) await startLearningRun({ binding: project.binding, kind: 'find-articles', ...(readingPackId ? { packId: readingPackId } : {}), articleIds: [article.id] }).catch(caught => showToast(`읽은 기록은 저장됐어요. 다음 글을 찾지 못했습니다: ${learningError(caught)}`, 'danger'))
    } catch (caught) { setError(learningError(caught)) }
    finally { setPending(false) }
  }

  return <div className="learning-reader-layout">
    <div className="learning-reader" ref={root} onMouseUp={() => { const value = root.current ? selectionInReader(article, root.current, window.getSelection()) : null; if (value) select(value) }}
      onScroll={event => {
        const element = event.currentTarget
        const fraction = element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight)
        const paragraphs = Array.from(element.querySelectorAll<HTMLElement>('[data-learning-paragraph]'))
        const top = element.getBoundingClientRect().top
        const visible = paragraphs.find(item => item.getBoundingClientRect().bottom > top + 100)
        progress.current = { paragraphId: visible?.dataset.learningParagraph ?? null, scrollFraction: Math.max(0, Math.min(1, fraction)) }
        if (progressTimer.current) clearTimeout(progressTimer.current)
        progressTimer.current = setTimeout(() => {
          const value = progress.current; progress.current = null
          if (value) void invoke('learning:saveProgress', { binding: project.binding, articleId: article.id, ...value }).then(onUpdate).catch(caught => setError(learningError(caught)))
        }, 700)
      }}>
      <article className="learning-reader-paper"><div className="learning-reader-meta"><span>{article.siteName ?? new URL(article.sourceUrl).hostname}</span><span>약 {article.estimatedMinutes}분 · {article.wordCount} words</span></div><h1>{article.title}</h1>{article.byline && <p className="learning-muted">{article.byline}</p>}<button type="button" className="learning-text-button" onClick={() => createBrowserTab(article.sourceUrl)}>원문 브라우저로 열기 <Icon name="link" /></button>
        <p className="learning-reader-hint">모르는 단어를 클릭하거나 표현을 드래그해서 단어장에 담으세요.</p>
        {article.paragraphs.map(paragraph => {
          const tokens: JSX.Element[] = []; let offset = 0
          for (const match of paragraph.text.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)) {
            const start = match.index; const end = start + match[0].length
            tokens.push(<span key={`text-${offset}`}>{paragraph.text.slice(offset, start)}</span>)
            const marked = saved.some(item => item.sourceRef.paragraphId === paragraph.id && (item.sourceRef.start ?? Infinity) < end && (item.sourceRef.end ?? -1) > start)
            const recurring = matches.get(paragraph.id)?.find(item => item.start < end && item.end > start)
            const selectToken = (): void => select(readerWordSelection(article, paragraph.id, recurring?.start ?? start, recurring?.end ?? end))
            tokens.push(<span key={`word-${start}`} className="learning-reader-word" data-saved={marked || undefined} data-recurring={recurring ? true : undefined} role="button" tabIndex={0} aria-label={`“${match[0]}” 단어 선택`} onClick={() => { if (!window.getSelection()?.toString()) selectToken() }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectToken() } }}>{match[0]}</span>)
            offset = end
          }
          tokens.push(<span key="last">{paragraph.text.slice(offset)}</span>)
          return <p key={paragraph.id} data-learning-paragraph={paragraph.id}>{tokens}</p>
        })}
        <footer className="learning-reader-footer"><p>이 글에서 {new Set(saved.map(item => item.wordId)).size}개의 단어를 담았어요.</p><button className="button button--primary" type="button" disabled={pending} onClick={() => void complete()}>{pending ? '처리 중…' : project.purpose === 'english-reading' && project.readingSetupConfirmed ? '읽기 완료 · 다음 글 찾기' : '읽기 완료'} <Icon name="chevronRight" /></button></footer>
      </article>
    </div>
    <aside className="learning-word-panel" aria-label="읽기 단어장"><p className="learning-eyebrow">WORDS IN CONTEXT</p><h2>{selected ? '이 표현을 기억해요' : '이 글의 단어'}</h2>
      {selected ? <div className="learning-word-selection"><h3>{selected.surface}</h3>{selectedWord && <p className="learning-notice">다시 만난 표현 · {selectedWord.meaning || '뜻 정리 전'}</p>}<blockquote>{selected.sentence}</blockquote><label className="learning-field"><span>뜻 또는 나의 메모 <small>(선택)</small></span><input className="text-field" value={meaning} onChange={event => setMeaning(event.target.value)} placeholder="비워두면 AI가 문맥 속 뜻을 정리해요" disabled={pending} /></label><button className="button button--primary" type="button" disabled={pending} onClick={() => void saveWord()}>{pending ? '단어장에 담는 중…' : selectedWord ? '이 문맥도 단어장에 담기' : '모르는 단어로 담기'}</button><button className="learning-text-button" type="button" disabled={pending} onClick={() => setSelected(null)}>선택 닫기</button>{priorExamples.length > 0 && <div className="learning-prior-examples"><h4>다른 글에서 만난 예문</h4>{priorExamples.slice(-3).map(occurrence => <blockquote key={occurrence.id}><p>{occurrence.sentence}</p>{occurrence.meaning && <small>{occurrence.meaning}</small>}<LearningSources binding={project.binding} sources={[occurrence.sourceRef]} onArticle={onArticle} /></blockquote>)}</div>}</div> : <p className="learning-muted">문장 속에서 다시 만날 때마다 단어의 쓰임을 쌓아가요.</p>}
      {notice && <p className="learning-notice" role="status">{notice}</p>}{error && <p className="learning-error" role="alert">{error}</p>}
      <div className="learning-word-mini-list">{[...new Set(saved.map(item => item.wordId))].map(id => { const word = project.words.find(item => item.id === id); return word ? <div key={id}><strong>{word.surface}</strong><span>{word.meaning || '문맥 속 뜻을 정리하는 중'}</span><button className="learning-text-button" type="button" disabled={pending} onClick={() => void explain(id)}>이 글의 문맥 설명</button></div> : null })}{saved.length === 0 && !selected && <div className="learning-empty">아직 담은 단어가 없어요.<p>궁금한 단어 하나부터 시작해 보세요.</p></div>}</div>
    </aside>
  </div>
}
