/**
 * Free-form PDF markup (pen, highlighter, shapes, text boxes).
 *
 * Deliberately SEPARATE from `types/annotation.ts`: that system anchors to
 * extracted text (quote/prefix/suffix) so it can detect drift when the source
 * PDF changes. Drawings have no text to anchor to — they are pure geometry.
 * Keeping them apart leaves the well-tested highlight path untouched.
 *
 * ALL coordinates are normalized to 0..1 against the *unrotated* page box, so
 * zoom, window resize and DPI changes need no migration. Same convention as
 * `AnnotationRect`.
 */

export type DrawingKind =
  | 'ink'
  | 'highlighter'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'textbox'

/** Named palette entry. Renderer maps these to theme tokens, never to hex. */
export type DrawingColor =
  | 'ink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'violet'

export interface DrawingPoint {
  x: number
  y: number
  /** Pointer pressure 0..1; 0.5 when the device reports none. */
  p: number
}

export interface DrawingBox {
  x: number
  y: number
  width: number
  height: number
}

/** Kind-specific geometry. `points` for strokes, `box` for shapes/text. */
export interface DrawingData {
  points?: DrawingPoint[]
  box?: DrawingBox
  /** textbox only. */
  text?: string
}

export interface DrawingStyle {
  color: DrawingColor
  /** Stroke width as a fraction of page width, so it scales with zoom. */
  width: number
  opacity: number
  /** textbox only — multiplier on the base note font size. */
  fontScale?: number
}

export interface Drawing {
  id: string
  courseId: string
  relPath: string
  /** 1-based, matching `Annotation.page`. */
  page: number
  kind: DrawingKind
  data: DrawingData
  style: DrawingStyle
  createdAt: string
  updatedAt: string
}

export interface CreateDrawingInput {
  courseId: string
  relPath: string
  page: number
  kind: DrawingKind
  data: DrawingData
  style: DrawingStyle
}

export interface UpdateDrawingInput {
  id: string
  data?: DrawingData
  style?: DrawingStyle
}

export interface ExportAnnotatedPdfInput {
  courseId: string
  relPath: string
}

export interface ExportAnnotatedPdfResult {
  /** Absolute path written, or null when the user cancelled the dialog. */
  savedPath: string | null
}
