import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Course } from '../../../../shared/types/course'
import type { OverlayState } from '../../../../shared/types/overlay'
import { invoke, onPush, type Unsubscribe } from '../../lib/ipc'
import { normalizeCourseColor } from '../courses/courseColors'
import { create } from 'zustand'
import { setOverlayState } from './useOverlayState'

interface OverlayCoursesState {
  courses: Course[]
  loading: boolean
  loadError: boolean
}

export const useOverlayCoursesStore = create<OverlayCoursesState>()(() => ({
  courses: [],
  loading: false,
  loadError: false
}))

let loadSequence = 0
let courseChipSubscribers = 0
let stopCourseChanges: Unsubscribe | null = null

export async function loadOverlayCourses(): Promise<Course[]> {
  const sequence = ++loadSequence
  useOverlayCoursesStore.setState({ loading: true, loadError: false })
  try {
    const courses = await invoke('courses:list', {})
    if (sequence === loadSequence) {
      useOverlayCoursesStore.setState({
        courses,
        loading: false,
        loadError: false
      })
    }
    return courses
  } catch (error) {
    if (sequence === loadSequence) {
      useOverlayCoursesStore.setState({ loading: false, loadError: true })
    }
    throw error
  }
}

export async function selectOverlayCourse(
  courseId: string
): Promise<OverlayState> {
  const state = await invoke('overlay:setCourse', { courseId })
  setOverlayState(state)
  return state
}

function reportCourseLoadError(error: unknown): void {
  console.error('[Bandal] 오버레이 과목 목록을 불러오지 못했습니다.', error)
}

function acquireCourseList(): Unsubscribe {
  courseChipSubscribers += 1
  if (courseChipSubscribers === 1) {
    stopCourseChanges = onPush('courses:changed', () => {
      void loadOverlayCourses().catch(reportCourseLoadError)
    })
    void loadOverlayCourses().catch(reportCourseLoadError)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    courseChipSubscribers = Math.max(0, courseChipSubscribers - 1)
    if (courseChipSubscribers === 0) {
      stopCourseChanges?.()
      stopCourseChanges = null
    }
  }
}

export interface CourseChipProps {
  courseId: string | null
}

export function CourseChip({ courseId }: CourseChipProps): JSX.Element {
  const courseState = useSyncExternalStore(
    useOverlayCoursesStore.subscribe,
    useOverlayCoursesStore.getState,
    useOverlayCoursesStore.getState
  )
  const { courses, loading, loadError } = courseState
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedCourse =
    courses.find((course) => course.id === courseId) ?? null

  useEffect(() => acquireCourseList(), [])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target) === false
      ) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const selectCourse = (nextCourseId: string): void => {
    setOpen(false)
    void selectOverlayCourse(nextCourseId).catch((error: unknown) => {
      console.error('[Bandal] 오버레이 과목을 바꾸지 못했습니다.', error)
    })
  }

  return (
    <div ref={rootRef} className="overlay-course">
      <button
        type="button"
        className="overlay-course__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedCourse !== null && (
          <span
            className="overlay-course__dot"
            data-course-color={normalizeCourseColor(selectedCourse.color)}
            aria-hidden="true"
          />
        )}
        <span className="overlay-course__label">
          {selectedCourse?.name ?? '과목 선택'}
        </span>
        <svg
          className="overlay-course__chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="m5 6 3 3 3-3" />
        </svg>
      </button>

      <div
        className="overlay-course__popover"
        role="listbox"
        aria-label="과목"
        hidden={!open}
      >
        {loading && courses.length === 0 ? (
          <p className="overlay-course__message" role="status">
            불러오는 중…
          </p>
        ) : loadError && courses.length === 0 ? (
          <p className="overlay-course__message" role="status">
            과목을 불러오지 못했어요
          </p>
        ) : courses.length === 0 ? (
          <p className="overlay-course__message">과목이 없어요</p>
        ) : (
          courses.map((course) => {
            const selected = course.id === courseId
            return (
              <button
                key={course.id}
                type="button"
                className="overlay-course__option"
                role="option"
                aria-selected={selected}
                onClick={() => selectCourse(course.id)}
              >
                <span
                  className="overlay-course__dot"
                  data-course-color={normalizeCourseColor(course.color)}
                  aria-hidden="true"
                />
                <span className="overlay-course__option-label">
                  {course.name}
                </span>
                {selected && (
                  <svg
                    className="overlay-course__check"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path d="m3.5 8.5 3 3 6-7" />
                  </svg>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
