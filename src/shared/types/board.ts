/**
 * Task board (kanban) types. Tasks may belong to a course or be global
 * (courseId === null).
 */

export type TaskStatus = 'todo' | 'in-progress' | 'done'

export interface BoardTask {
  id: string
  /** null = global task not tied to a course. */
  courseId: string | null
  title: string
  notes: string
  status: TaskStatus
  /** ISO datetime, null when the task has no due date. */
  dueAt: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateTaskInput {
  courseId: string | null
  title: string
  notes?: string
  status?: TaskStatus
  dueAt?: string | null
}

export interface UpdateTaskInput {
  id: string
  title?: string
  notes?: string
  status?: TaskStatus
  dueAt?: string | null
  sortOrder?: number
}

export interface ListTasksInput {
  /** Omit to list tasks for all courses plus global tasks. */
  courseId?: string | null
  includeDone?: boolean
}
