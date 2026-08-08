/**
 * Deep links between a note and the material it is about.
 *
 * Written into markdown as an ordinary link, so the file stays a plain `.md`
 * that opens correctly in any other editor — the target just does not resolve
 * outside Bandal. Storing a proprietary block instead would make the student's
 * notes unreadable elsewhere, which defeats the point of keeping them as files.
 *
 *   [3쪽 “해시 충돌…”](bandal://material?path=Chap1.pdf&page=3)
 */
export const BANDAL_LINK_SCHEME = 'bandal:'

export interface MaterialLink {
  /** Course-relative path. */
  relPath: string
  /** 1-based page for PDFs; null for whole-file links. */
  page: number | null
  /** Annotation to flash on arrival, when the link came from a highlight. */
  annotationId?: string
}

export interface SendHighlightToNoteInput {
  courseId: string
  /** Source material. */
  relPath: string
  page: number
  quote: string
  comment: string | null
  annotationId: string
  /**
   * Target note. Omit to append to the course's default study note, which is
   * created on first use.
   */
  noteRelPath?: string
}

export interface SendHighlightToNoteResult {
  /** Note that was written to. */
  relPath: string
  created: boolean
}
