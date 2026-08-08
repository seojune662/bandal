import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { BoardTask, TaskKind } from '../../../../shared/types/board'
import type { Course } from '../../../../shared/types/course'
import { Icon } from '../../app/icons'
import { invoke } from '../../lib/ipc'
import { normalizeCourseColor } from '../courses/courseColors'
import {
  calendarMonthGrid,
  dueAtForLocalInput,
  localDateKey,
  localTimeInput,
  taskIsOverdue
} from './calendarDate'
import './calendar.css'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const
const KIND_LABELS: Record<TaskKind, string> = {
  task: '할 일',
  assignment: '과제',
  exam: '시험',
  class: '수업'
}

export interface CalendarViewProps {
  courses: readonly Course[]
  /** undefined = all courses, null = global entries. */
  courseId: string | null | undefined
  onTasksChanged?: () => void | Promise<void>
  refreshKey?: number
}

interface CalendarDraft {
  title: string
  kind: TaskKind
  courseId: string | null
  dueAt: string
  allDay: boolean
  dateKey: string
}

interface CalendarTaskFormProps {
  task: BoardTask | null
  dateKey: string
  defaultCourseId: string | null
  courses: readonly Course[]
  busy: boolean
  onCancel: () => void
  onSubmit: (draft: CalendarDraft) => Promise<void>
  onDelete?: () => Promise<void>
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : '일정을 불러오지 못했습니다.'
}

function monthTitle(cursor: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long'
  }).format(cursor)
}

function fullDateTitle(key: string): string {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    ...(year !== new Date().getFullYear() ? { year: 'numeric' as const } : {})
  }).format(new Date(year, month - 1, day))
}

function timeLabel(task: BoardTask): string | null {
  if (task.allDay || task.dueAt === null) return null
  const date = new Date(task.dueAt)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function courseFor(task: BoardTask, courses: readonly Course[]): Course | null {
  return courses.find((course) => course.id === task.courseId) ?? null
}

function CalendarTaskForm({
  task,
  dateKey,
  defaultCourseId,
  courses,
  busy,
  onCancel,
  onSubmit,
  onDelete
}: CalendarTaskFormProps): JSX.Element {
  const [title, setTitle] = useState(task?.title ?? '')
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? 'assignment')
  const [courseId, setCourseId] = useState(task?.courseId ?? defaultCourseId ?? '')
  const [day, setDay] = useState(task?.dueAt == null ? dateKey : localDateKey(task.dueAt))
  const [time, setTime] = useState(localTimeInput(task?.dueAt ?? null))
  const [allDay, setAllDay] = useState(task?.allDay ?? false)
  const [error, setError] = useState<string | null>(null)
  const currentCourseMissing =
    courseId.length > 0 && !courses.some((course) => course.id === courseId)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (title.trim().length === 0 || day.length === 0) {
      setError('제목과 날짜를 입력해주세요.')
      return
    }
    setError(null)
    try {
      await onSubmit({
        title: title.trim(),
        kind,
        courseId: courseId.length === 0 ? null : courseId,
        dueAt: dueAtForLocalInput(day, time, allDay),
        allDay,
        dateKey: day
      })
    } catch (submitError) {
      setError(messageFor(submitError))
    }
  }

  return (
    <form className="calendar-form" onSubmit={(event) => void submit(event)}>
      <label className="board-field">
        <span>제목</span>
        <input
          value={title}
          maxLength={200}
          required
          autoFocus
          placeholder="과제나 시험 이름"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="calendar-form__row">
        <label className="board-field">
          <span>종류</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as TaskKind)}>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="board-field">
          <span>과목</span>
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">전체</option>
            {currentCourseMissing && <option value={courseId}>목록에 없는 과목</option>}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>{course.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="calendar-form__row calendar-form__date-row">
        <label className="board-field">
          <span>날짜</span>
          <input type="date" value={day} required onChange={(event) => setDay(event.target.value)} />
        </label>
        <label className="board-field">
          <span>마감 시각</span>
          <input
            type="time"
            value={time}
            disabled={allDay}
            required={!allDay}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
      </div>
      <label className="calendar-form__all-day">
        <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
        하루 종일
      </label>
      {error !== null && <p className="calendar-form__error" role="alert">{error}</p>}
      <footer className="calendar-form__actions">
        {onDelete !== undefined && (
          <button
            type="button"
            className="board-button board-button--danger"
            disabled={busy}
            onClick={() => void onDelete().catch((deleteError) => setError(messageFor(deleteError)))}
          >
            <Icon name="trash" /> 삭제
          </button>
        )}
        <span className="calendar-form__action-spacer" />
        <button type="button" className="board-button" disabled={busy} onClick={onCancel}>취소</button>
        <button type="submit" className="board-button board-button--primary" disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
      </footer>
    </form>
  )
}

export function CalendarView({
  courses,
  courseId,
  onTasksChanged,
  refreshKey = 0
}: CalendarViewProps): JSX.Element {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedKey, setSelectedKey] = useState(() => localDateKey(today))
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSequence = useRef(0)
  const grid = useMemo(() => calendarMonthGrid(cursor, today), [cursor, today])

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setError(null)
    try {
      const result = await invoke('calendar:range', {
        from: grid.from,
        to: grid.to,
        ...(courseId === undefined ? {} : { courseId })
      })
      if (sequence === loadSequence.current) setTasks(result)
    } catch (loadError) {
      if (sequence === loadSequence.current) setError(messageFor(loadError))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [courseId, grid.from, grid.to])

  useEffect(() => {
    void load()
    return () => { loadSequence.current += 1 }
  }, [load, refreshKey])

  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, BoardTask[]>()
    tasks.forEach((task) => {
      if (task.dueAt === null) return
      const key = localDateKey(task.dueAt)
      const entries = grouped.get(key) ?? []
      entries.push(task)
      grouped.set(key, entries)
    })
    grouped.forEach((entries) => entries.sort((left, right) => {
      if (left.allDay !== right.allDay) return left.allDay ? -1 : 1
      return (left.dueAt ?? '').localeCompare(right.dueAt ?? '')
    }))
    return grouped
  }, [tasks])

  const selectDay = (key: string): void => {
    setSelectedKey(key)
    setEditingId(null)
    setAdding(false)
  }

  const refreshAfterMutation = async (): Promise<void> => {
    await load()
    await onTasksChanged?.()
  }

  const createTask = async (draft: CalendarDraft): Promise<void> => {
    setMutating(true)
    try {
      await invoke('board:createTask', {
        courseId: draft.courseId,
        title: draft.title,
        status: 'todo',
        kind: draft.kind,
        dueAt: draft.dueAt,
        allDay: draft.allDay
      })
      setSelectedKey(draft.dateKey)
      setAdding(false)
      await refreshAfterMutation()
    } finally {
      setMutating(false)
    }
  }

  const editingTask = tasks.find((task) => task.id === editingId) ?? null
  const updateTask = async (task: BoardTask, draft: CalendarDraft): Promise<void> => {
    setMutating(true)
    try {
      await invoke('board:updateTask', {
        id: task.id,
        title: draft.title,
        kind: draft.kind,
        dueAt: draft.dueAt,
        allDay: draft.allDay,
        ...(draft.courseId === task.courseId ? {} : { courseId: draft.courseId })
      })
      setSelectedKey(draft.dateKey)
      setEditingId(null)
      await refreshAfterMutation()
    } finally {
      setMutating(false)
    }
  }

  const deleteTask = async (task: BoardTask): Promise<void> => {
    if (!window.confirm(`“${task.title}” 일정을 삭제할까요?`)) return
    setMutating(true)
    try {
      await invoke('board:deleteTask', { id: task.id })
      setEditingId(null)
      await refreshAfterMutation()
    } finally {
      setMutating(false)
    }
  }

  const selectedTasks = tasksByDay.get(selectedKey) ?? []
  const moveMonth = (offset: number): void => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
    setEditingId(null)
    setAdding(false)
  }
  const goToday = (): void => {
    const now = new Date()
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1))
    selectDay(localDateKey(now))
  }

  return (
    <div className="calendar" aria-busy={loading || mutating}>
      <section className="calendar-month" aria-label={`${monthTitle(cursor)} 달력`}>
        <header className="calendar-month__nav">
          <div className="calendar-month__nav-buttons">
            <button type="button" className="board-icon-button" aria-label="이전 달" onClick={() => moveMonth(-1)}>
              <Icon name="chevronRight" />
            </button>
            <button type="button" className="board-button" onClick={goToday}>오늘</button>
            <button type="button" className="board-icon-button" aria-label="다음 달" onClick={() => moveMonth(1)}>
              <Icon name="chevronRight" />
            </button>
          </div>
          <h3>{monthTitle(cursor)}</h3>
          <span className="calendar-month__count">{tasks.length}개 일정</span>
        </header>
        {error !== null && (
          <div className="board-error" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="다시 시도" onClick={() => void load()}><Icon name="refresh" /></button>
          </div>
        )}
        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-grid">
          {grid.days.map((day) => {
            const dayTasks = tasksByDay.get(day.key) ?? []
            return (
              <section
                key={day.key}
                className="calendar-day"
                data-outside={!day.inMonth || undefined}
                data-today={day.isToday || undefined}
                data-selected={selectedKey === day.key || undefined}
              >
                <button type="button" className="calendar-day__number" onClick={() => selectDay(day.key)}>
                  <time dateTime={day.key} aria-current={day.isToday ? 'date' : undefined}>{day.date.getDate()}</time>
                  <span className="sr-only">{fullDateTitle(day.key)} 일정 보기</span>
                </button>
                <div className="calendar-day__items">
                  {dayTasks.slice(0, 3).map((task) => {
                    const course = courseFor(task, courses)
                    return (
                      <button
                        key={task.id}
                        type="button"
                        className="calendar-entry"
                        data-kind={task.kind}
                        data-overdue={taskIsOverdue(task) || undefined}
                        data-done={task.status === 'done' || undefined}
                        data-course-color={course === null ? undefined : normalizeCourseColor(course.color)}
                        title={`${KIND_LABELS[task.kind]} · ${task.title}`}
                        onClick={() => { setSelectedKey(day.key); setAdding(false); setEditingId(task.id) }}
                      >
                        <span className="board-course-dot" aria-hidden="true" />
                        <span className="calendar-entry__kind">{KIND_LABELS[task.kind]}</span>
                        <span className="calendar-entry__title">{task.title}</span>
                        {timeLabel(task) !== null && <time>{timeLabel(task)}</time>}
                      </button>
                    )
                  })}
                  {dayTasks.length > 3 && (
                    <button type="button" className="calendar-day__more" onClick={() => selectDay(day.key)}>
                      {dayTasks.length - 3}개 더 보기
                    </button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </section>

      <aside className="calendar-agenda" aria-label={`${fullDateTitle(selectedKey)} 일정`}>
        <header className="calendar-agenda__header">
          <div>
            <p className="board-eyebrow">SELECTED DAY</p>
            <h3>{fullDateTitle(selectedKey)}</h3>
          </div>
          {!adding && editingTask === null && (
            <button type="button" className="board-button board-button--primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> 일정 추가
            </button>
          )}
        </header>

        {adding ? (
          <CalendarTaskForm
            key={`new-${selectedKey}`}
            task={null}
            dateKey={selectedKey}
            defaultCourseId={courseId ?? null}
            courses={courses}
            busy={mutating}
            onCancel={() => setAdding(false)}
            onSubmit={createTask}
          />
        ) : editingTask !== null ? (
          <CalendarTaskForm
            key={editingTask.id}
            task={editingTask}
            dateKey={selectedKey}
            defaultCourseId={courseId ?? null}
            courses={courses}
            busy={mutating}
            onCancel={() => setEditingId(null)}
            onSubmit={(draft) => updateTask(editingTask, draft)}
            onDelete={() => deleteTask(editingTask)}
          />
        ) : selectedTasks.length === 0 ? (
          <div className="calendar-agenda__empty">
            <strong>등록된 일정이 없어요</strong>
            <p>이 날짜에 과제, 시험 또는 수업을 추가할 수 있어요.</p>
          </div>
        ) : (
          <ul className="calendar-agenda__list">
            {selectedTasks.map((task) => {
              const course = courseFor(task, courses)
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    className="calendar-agenda__item"
                    data-kind={task.kind}
                    data-overdue={taskIsOverdue(task) || undefined}
                    data-course-color={course === null ? undefined : normalizeCourseColor(course.color)}
                    onClick={() => setEditingId(task.id)}
                  >
                    <span className="board-course-dot" aria-hidden="true" />
                    <span>
                      <strong>{task.title}</strong>
                      <small>{KIND_LABELS[task.kind]} · {course?.name ?? '전체'}{timeLabel(task) === null ? '' : ` · ${timeLabel(task)}`}</small>
                    </span>
                    <Icon name="chevronRight" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </div>
  )
}
