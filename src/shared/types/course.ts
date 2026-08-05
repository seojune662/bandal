/**
 * Course domain types. A course maps 1:1 to a folder under
 * ~/Documents/Bandal/<slug>.
 */

export interface Course {
  id: string
  name: string
  /** URL/filesystem-safe slug derived from the name. */
  slug: string
  /** Semantic color key or CSS color used for course identity. */
  color: string
  /** Absolute path to the course folder on disk. */
  folderPath: string
  archived: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateCourseInput {
  name: string
  color: string
}

export interface RenameCourseInput {
  courseId: string
  name: string
}
