import { useCallback, useEffect, useState } from 'react'
import type { TaskKind, UpcomingDeadline } from '../../../../shared/types/board'
import { invoke } from '../../lib/ipc'
import './upcomingDeadlines.css'

const KIND_LABELS: Record<TaskKind, string> = {
  task: '할 일',
  assignment: '과제',
  exam: '시험',
  class: '수업'
}

export interface UpcomingDeadlinesProps {
  courseId?: string | null
  withinDays?: number
  limit?: number
  className?: string
}

function dDayLabel(deadline: UpcomingDeadline): string {
  if (deadline.overdue) {
    return deadline.daysLeft === 0 ? '오늘 지남' : `${Math.abs(deadline.daysLeft)}일 지남`
  }
  if (deadline.daysLeft === 0) return 'D-Day'
  return `D-${deadline.daysLeft}`
}

/** Compact, empty-safe deadline list intended for a course sidebar row. */
export function UpcomingDeadlines({
  courseId,
  withinDays = 14,
  limit = 2,
  className
}: UpcomingDeadlinesProps): JSX.Element | null {
  const [deadlines, setDeadlines] = useState<UpcomingDeadline[]>([])

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await invoke('calendar:upcoming', {
        withinDays,
        limit,
        ...(courseId === undefined ? {} : { courseId })
      })
      setDeadlines(result)
    } catch {
      setDeadlines([])
    }
  }, [courseId, limit, withinDays])

  useEffect(() => {
    void load()
    const refresh = (): void => { void load() }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 5 * 60 * 1000)
    return () => {
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [load])

  if (deadlines.length === 0) return null

  return (
    <ul className={['upcoming-deadlines', className].filter(Boolean).join(' ')} aria-label="임박한 마감">
      {deadlines.map((deadline) => (
        <li key={deadline.task.id} data-overdue={deadline.overdue || undefined}>
          <span className="upcoming-deadlines__title">
            {KIND_LABELS[deadline.task.kind]} {deadline.task.title}
          </span>
          <span className="upcoming-deadlines__day">{dDayLabel(deadline)}</span>
        </li>
      ))}
    </ul>
  )
}
