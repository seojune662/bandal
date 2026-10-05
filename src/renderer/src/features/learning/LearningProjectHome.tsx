import type { LearningProjectSnapshot, LearningRunKind } from '../../../../shared/types/learning'
import type { LearningView } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { dueLearningCards } from './LearningReview'
import { LearningSources } from './LearningSources'
import { learningProgressMetrics } from './learningMetrics'
import { isEnglishReading, learningPurposeLabel } from './learningPurpose'

export function LearningProjectHome({ project, pending, running, onNavigate, onRun, onSettings }: {
  project: LearningProjectSnapshot
  pending: boolean
  running: boolean
  onNavigate: (view: LearningView, itemId?: string) => void
  onRun: (kind: LearningRunKind, articleIds?: string[], wordIds?: string[]) => void
  onSettings: () => void
}): JSX.Element {
  const english = isEnglishReading(project)
  const due = dueLearningCards(project)
  const metrics = learningProgressMetrics(project)
  const nextArticle = project.articles.find(item => item.status === 'reading') ?? project.articles.find(item => item.status === 'unread')
  const courses = useCoursesStore(state => state.courses)
  const linkedCourse = courses.find(course => course.id === (project.linkedCourseId ?? (course.workspaceKind !== 'study-space' ? project.binding.courseId : undefined)))
  const latestArtifact = project.artifacts.at(-1)
  const sources = project.artifacts.flatMap(item => item.sourceRefs).filter((source, index, all) => all.findIndex(item => item.sourceCourseId === source.sourceCourseId && item.relPath === source.relPath && item.articleId === source.articleId && item.quote === source.quote) === index).slice(0, 8)
  return <>
    <div className="learning-hero"><div><p className="learning-eyebrow">{learningPurposeLabel(project)}</p>
      <h1>{english ? project.articles.length === 0 ? '좋아하는 이야기로 시작해요.' : '다음 문장에서 다시 만나요.' : project.purpose === 'course-review' ? '내 자료를 다시 익혀요.' : '어떤 학습 공간인지 확인해 주세요.'}</h1>
      <p className="learning-lead">{english ? `${project.topic}에 관한 짧은 영어 글을 읽으며, 나만의 단어와 예문을 쌓아가요.` : project.purpose === 'course-review' ? `${linkedCourse?.name ? `${linkedCourse.name}의 ` : ''}자료로 만든 퀴즈와 카드, 복습 결과가 이곳에 모입니다.` : '기존 기사, 단어, 퀴즈와 카드는 보존되어 있습니다. 종류와 AI 설정을 확인하면 학습을 이어갈 수 있어요.'}</p>
      {english ? <button type="button" className="button button--primary" disabled={pending || !nextArticle && running} onClick={() => nextArticle ? onNavigate('reader', nextArticle.id) : onRun('find-articles')}>{nextArticle ? '이어서 읽기' : '첫 영어 글 찾기'} <Icon name="chevronRight" /></button>
        : project.purpose === 'course-review' ? <button type="button" className="button button--primary" onClick={() => onNavigate('review', latestArtifact?.id)}>{latestArtifact ? '최근 복습 자료 열기' : '퀴즈 · 카드 보기'} <Icon name="chevronRight" /></button>
        : <button type="button" className="button button--primary" onClick={onSettings}>학습 종류와 AI 확인하기 <Icon name="chevronRight" /></button>}
    </div><div className="learning-hero-orbit" aria-hidden="true"><span>{english ? 'Aa' : '▤'}</span><small>{english ? 'READ · REMEMBER · REPEAT' : 'REVIEW · REMEMBER'}</small></div></div>
    <div className="learning-stats">
      {english ? <><button type="button" onClick={() => onNavigate('articles')}><strong>{project.articles.filter(item => item.status === 'completed').length}</strong><span>읽은 글</span></button><button type="button" onClick={() => onNavigate('vocabulary')}><strong>{project.words.length}</strong><span>나의 단어</span></button><button type="button" onClick={() => onNavigate('vocabulary')}><strong>{project.words.filter(item => item.status === 'known').length}</strong><span>익숙해진 단어</span></button></>
        : <><button type="button" onClick={() => onNavigate('review')}><strong>{project.artifacts.filter(item => item.kind === 'quiz').length}</strong><span>퀴즈</span></button><button type="button" onClick={() => onNavigate('review')}><strong>{project.artifacts.filter(item => item.kind === 'cards').length}</strong><span>카드 묶음</span></button><button type="button" onClick={() => onNavigate('review')}><strong>{project.quizAttempts.filter(item => !!item.completedAt).length}</strong><span>완료한 퀴즈</span></button></>}
      <button type="button" onClick={() => onNavigate('review')}><strong>{due.length}</strong><span>오늘의 복습 카드</span></button>
    </div>
    <div className="learning-insights">{english && <div><strong>{metrics.encounteredWordCount}</strong><span>읽은 다른 글에서 다시 만난 단어</span></div>}<div><strong>{metrics.reviewedCardCount}</strong><span>복습한 카드</span></div>{metrics.latestQuiz && <div><strong>{metrics.latestQuiz.score} / {metrics.latestQuiz.total}</strong><span>최근 퀴즈 자동 채점 · 단답형 {metrics.latestQuiz.selfPassedCount} / {metrics.latestQuiz.selfCheckedCount}</span></div>}</div>
    {english && nextArticle && <button className="learning-next-article" type="button" onClick={() => onNavigate('reader', nextArticle.id)}><div><p className="learning-eyebrow">{nextArticle.status === 'reading' ? 'CONTINUE READING' : 'UP NEXT'}</p><h2>{nextArticle.title}</h2><span>약 {nextArticle.estimatedMinutes}분 · 내 단어 {nextArticle.matchedWordIds.length}개 다시 만나기</span></div><Icon name="chevronRight" /></button>}
    {project.purpose === 'course-review' && <section className="learning-review-sources"><div className="learning-section-heading"><h2>연결된 원본 자료</h2>{linkedCourse && <button className="learning-text-button" type="button" onClick={() => { useCoursesStore.getState().selectCourse(linkedCourse.id); useUiStore.getState().showCourses() }}>원본 과목 열기 <Icon name="chevronRight" /></button>}</div><LearningSources sources={sources} binding={project.binding} onArticle={id => onNavigate('reader', id)} />{sources.length === 0 && <p className="learning-muted">과목 자료에서 퀴즈나 카드를 만들면 원본 출처가 함께 연결됩니다.</p>}</section>}
    <div className="learning-section-heading"><h2>쌓여가는 학습 기록</h2>{english && <button className="learning-text-button" type="button" disabled={pending || running || project.words.length === 0} onClick={() => onRun('create-summary', undefined, project.words.map(word => word.id))}>단어와 예문 정리하기</button>}</div>
    <ol className="learning-history">{project.history.slice(-8).reverse().map(item => <li key={item.id}><span>{item.summary}</span><time>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</time></li>)}</ol>{project.history.length === 0 && <p className="learning-muted">학습을 진행하면 기록이 이곳에 쌓입니다.</p>}
  </>
}
