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

/**
 * A quote clipped from a web page in the embedded browser.
 *
 * Deliberately a sibling of `SendHighlightToNoteInput` rather than a widening
 * of it: that one's `relPath`/`page`/`annotationId` are required and carry the
 * backlink index. A web clip has no material behind it, so the source line is
 * an ordinary markdown link and the note stays readable in any editor.
 */
export interface SendWebClipToNoteInput {
  courseId: string
  /** Page the quote came from. */
  url: string
  /** Page title; falls back to the host when a page has none. */
  title: string
  quote: string
  comment: string | null
  /** Omit to append to the course's default study note. */
  noteRelPath?: string
}

export interface SendHighlightToNoteResult {
  /** Note that was written to. */
  relPath: string
  created: boolean
}

/**
 * One place that points at a material — the reverse of `MaterialLink`.
 *
 * The forward direction (note → PDF page) has always worked: the markdown
 * holds a `bandal://material?…` href you can click. The reverse — "which of
 * my notes quote this page?" — had no representation at all, because those
 * hrefs live in file text rather than in a table.
 */
export interface MaterialBacklink {
  /** Note: course-relative path. Whiteboard: board id. */
  ref: string
  /** What to show: note filename or board title. */
  label: string
  /** Page of the target material, when the citation named one. */
  page: number | null
}

export interface MaterialBacklinks {
  notes: MaterialBacklink[]
  boards: MaterialBacklink[]
}
