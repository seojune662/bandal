/**
 * [M8] Per-course shortcuts, pinned under the selected course in the rail.
 *
 * The flow is "paste an address", never "type a course id" — a student can
 * copy an address bar but has no idea what Canvas calls a course
 * (docs/university-sites.md §4.3). What they paste is matched against the
 * school's CourseLinkSpec: a hit is normalised to the course root and
 * labelled 강의실, a miss is still saved as a plain link.
 */

import { useEffect, useId, useState } from 'react'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { useCourseLinksStore } from '../../stores/courseLinksStore'
import { useUniversityStore } from '../../stores/universityStore'
import { openInBandalBrowser } from './openService'
import { courseUrlErrorMessage } from './serviceCopy'
import { PinIcon } from './universityIcons'
import './university.css'

export function CourseLinks({ courseId }: { courseId: string }): JSX.Element {
  const links = useCourseLinksStore((state) => state.byCourse[courseId])
  const load = useCourseLinksStore((state) => state.load)
  const addFromUrl = useCourseLinksStore((state) => state.addFromUrl)
  const remove = useCourseLinksStore((state) => state.remove)
  const pendingCourseId = useCourseLinksStore((state) => state.pendingCourseId)
  const university = useUniversityStore((state) => state.university)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  useEffect(() => {
    if (links === undefined) void load(courseId)
  }, [courseId, links, load])

  const spec = university?.courseLink ?? null
  const pending = pendingCourseId === courseId

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    try {
      const parse = await addFromUrl({ courseId, rawUrl: draft, spec: spec })
      if (parse.status === 'invalid') {
        setError(courseUrlErrorMessage(parse.reason))
        return
      }
      setDraft('')
      setAdding(false)
      showToast(
        parse.status === 'lms-course'
          ? parse.reliable
            ? '강의실 링크로 저장했어요.'
            : '강의실 링크로 저장했어요. 이 학교는 아직 베타예요.'
          : '링크를 저장했어요.'
      )
    } catch {
      setError('링크를 저장하지 못했어요. 잠시 후 다시 시도해주세요.')
    }
  }

  return (
    <div className="course-links">
      {links !== undefined && links.length > 0 && (
        <ul className="course-links__list">
          {links.map((link) => (
            <li key={link.id} className="course-links__item">
              <button
                type="button"
                className="course-links__open"
                title={link.url}
                onClick={() => openInBandalBrowser(link.url)}
              >
                <PinIcon className="course-links__pin" />
                <span className="course-links__label">{link.label}</span>
              </button>
              <button
                type="button"
                className="course-links__remove"
                aria-label={`${link.label} 링크 삭제`}
                onClick={() => void remove(link.id, courseId)}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="course-links__form" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor={inputId}>
            링크 주소
          </label>
          <input
            id={inputId}
            className="university-field course-links__input"
            value={draft}
            placeholder="주소를 붙여넣어 주세요"
            autoComplete="off"
            autoFocus
            disabled={pending}
            aria-invalid={error !== null}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setAdding(false)
                setError(null)
              }
            }}
          />
          {spec !== null && error === null && (
            <p className="course-links__hint">{spec.hint}</p>
          )}
          {error !== null && (
            <p className="university-error" role="alert">
              {error}
            </p>
          )}
          <div className="course-links__form-actions">
            <button
              type="button"
              className="course-links__cancel"
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
            >
              취소
            </button>
            <button
              type="submit"
              className="university-button university-button--primary course-links__submit"
              disabled={pending || draft.trim().length === 0}
            >
              {pending ? '저장 중…' : '추가'}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="course-links__add"
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" />
          링크 추가
        </button>
      )}
    </div>
  )
}
