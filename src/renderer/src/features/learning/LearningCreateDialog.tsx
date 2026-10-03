import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LearningBinding, LearningLevel } from '../../../../shared/types/learning'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useFocusTrap } from '../../components/useFocusTrap'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { useCoursesStore } from '../../stores/coursesStore'
import { useMaterialsStore } from '../../stores/materialsStore'
import { learningError, notifyLearningChanged, openLearning } from './learningNavigation'
import './learning.css'

export function LearningCreateDialog({ courseId, onClose, onCreated }: { courseId?: string; onClose: () => void; onCreated?: (binding: LearningBinding) => void }): JSX.Element {
  const courses = useCoursesStore(state => state.courses)
  const [placement, setPlacement] = useState<'standalone' | 'in-course'>(courseId ? 'in-course' : 'standalone')
  const [selectedCourse, setSelectedCourse] = useState(courseId ?? courses[0]?.id ?? '')
  const [name, setName] = useState('나의 영어 읽기')
  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState<LearningLevel>('intermediate')
  const [minutes, setMinutes] = useState(4)
  const [rootRelPath, setRootRelPath] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const titleId = useId()
  useFocusTrap(root, { active: true, initialFocus: input, onEscape: pending ? undefined : onClose })
  useEffect(() => acquirePointerPassthrough(), [])

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setPending(true); setError(null)
    try {
      const project = await invoke('learning:create', { placement, name: name.trim(), topic: topic.trim(), level, readingMinutes: minutes,
        ...(placement === 'in-course' ? { courseId: selectedCourse, ...(rootRelPath.trim() ? { rootRelPath: rootRelPath.trim() } : {}) } : {}) })
      await useCoursesStore.getState().loadCourses()
      openLearning(project.binding)
      void useMaterialsStore.getState().loadTree(project.binding.courseId)
      notifyLearningChanged()
      onCreated?.(project.binding)
      void invoke('learning:run', { binding: project.binding, kind: 'find-articles' }).catch(caught => showToast(learningError(caught), 'danger'))
      onClose()
    } catch (caught) { setError(learningError(caught)); setPending(false) }
  }

  return createPortal(<div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !pending) onClose() }}>
    <section ref={root} className="course-dialog learning-create learning-create--form" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="course-dialog__header"><div><p className="eyebrow">READ · COLLECT · CONNECT</p><h2 id={titleId}>영어 읽기 시작하기</h2></div><button className="bare-icon-button" type="button" aria-label="닫기" disabled={pending} onClick={onClose}><Icon name="x" /></button></header>
      <form className="learning-create__form" onSubmit={event => void create(event)}>
        <div className="learning-dialog-body">
        <p className="learning-muted">관심 있는 글을 읽고, 모르는 단어를 담고, 다음 글에서 다시 만나요.</p>
        <label className="learning-field"><span>학습 공간 이름</span><input ref={input} className="text-field" value={name} maxLength={80} required disabled={pending} onChange={event => setName(event.target.value)} /></label>
        <label className="learning-field"><span>관심 주제</span><input className="text-field" value={topic} placeholder="예: 우주 탐사, 디자인, 축구, AI" maxLength={500} required disabled={pending} onChange={event => setTopic(event.target.value)} /></label>
        <div className="learning-form-row"><label className="learning-field"><span>편한 영어 수준</span><select value={level} disabled={pending} onChange={event => setLevel(event.target.value as LearningLevel)}><option value="beginner">기초 · 쉬운 문장부터</option><option value="intermediate">중급 · 일반적인 기사</option><option value="advanced">고급 · 깊이 있는 글</option></select></label><label className="learning-field"><span>한 편의 읽기 시간</span><select value={minutes} disabled={pending} onChange={event => setMinutes(Number(event.target.value))}><option value={4}>3~5분 · 가볍게 읽기</option><option value={3}>약 3분</option><option value={5}>약 5분</option><option value={8}>약 8분</option></select></label></div>
        <fieldset className="learning-placement"><legend>자료를 쌓을 곳</legend><label><input type="radio" name="learning-placement" checked={placement === 'standalone'} disabled={pending} onChange={() => setPlacement('standalone')} /><strong>독립 학습 공간</strong><span>과목과 나란히 사용할 전용 폴더</span></label><label><input type="radio" name="learning-placement" checked={placement === 'in-course'} disabled={pending || courses.length === 0} onChange={() => setPlacement('in-course')} /><strong>기존 과목 안에</strong><span>지금 쓰는 자료와 함께 보관</span></label></fieldset>
        {placement === 'in-course' && <div className="learning-form-row"><label className="learning-field"><span>과목</span><select value={selectedCourse} required disabled={pending} onChange={event => setSelectedCourse(event.target.value)}>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label><label className="learning-field"><span>폴더 이름 <small>(선택)</small></span><input className="text-field" value={rootRelPath} placeholder={name} disabled={pending} onChange={event => setRootRelPath(event.target.value)} /></label></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer className="dialog-actions"><button type="button" className="button button--secondary" disabled={pending} onClick={onClose}>취소</button><button type="submit" className="button button--primary" disabled={pending || !name.trim() || !topic.trim() || (placement === 'in-course' && !selectedCourse)}>{pending ? '학습 공간 만드는 중…' : '학습 공간 만들기'}</button></footer>
      </form>
    </section>
  </div>, document.body)
}
