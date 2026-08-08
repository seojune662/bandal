import type { BoardTask } from '../../../../shared/types/board'

const DAY_MS = 24 * 60 * 60 * 1000

export interface CalendarGridDay {
  date: Date
  key: string
  inMonth: boolean
  isToday: boolean
}

export interface CalendarMonthGrid {
  days: CalendarGridDay[]
  from: string
  to: string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Stable YYYY-MM-DD key using local—not UTC—date parts. */
export function localDateKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Difference between local calendar dates, independent of hours and DST. */
export function localCalendarDayDifference(due: Date, now: Date): number {
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate())
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((dueDay - nowDay) / DAY_MS)
}

export function localDateFromKey(key: string, time = '00:00'): Date {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number)
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute)
}

export function dueAtForLocalInput(
  dateKey: string,
  time: string,
  allDay: boolean
): string {
  return localDateFromKey(dateKey, allDay ? '00:00' : time).toISOString()
}

export function localTimeInput(value: string | null): string {
  if (value === null) return '23:59'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '23:59'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function calendarMonthGrid(
  cursor: Date,
  today: Date = new Date()
): CalendarMonthGrid {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1)
  const monthDays = new Date(year, month + 1, 0).getDate()
  const cellCount = Math.ceil((first.getDay() + monthDays) / 7) * 7
  const start = new Date(year, month, 1 - first.getDay())
  const days = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return {
      date,
      key: localDateKey(date),
      inMonth: date.getMonth() === month,
      isToday: localDateKey(date) === localDateKey(today)
    }
  })
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + cellCount
  )
  return { days, from: start.toISOString(), to: end.toISOString() }
}

export function taskIsOverdue(task: BoardTask, now: Date = new Date()): boolean {
  if (task.dueAt === null || task.status === 'done') return false
  const due = new Date(task.dueAt)
  if (Number.isNaN(due.getTime())) return false
  return task.allDay
    ? localCalendarDayDifference(due, now) < 0
    : due.getTime() < now.getTime()
}
