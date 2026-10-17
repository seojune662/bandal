export type NotePaper = 'blank' | 'lines' | 'grid' | 'dots'
export type NoteOrientation = 'portrait' | 'landscape'
export type NoteSurface = 'light' | 'dark'
export interface CreatePdfNoteInput { courseId: string; title: string; paper?: NotePaper; orientation?: NoteOrientation }
export interface PdfNoteInfo { documentRevision: string; paper: NotePaper | null; surface: NoteSurface; orientation: NoteOrientation }
export interface PdfPageRecipe { source: number | null; rotate?: 0 | 90 | 180 | 270 }
export interface RestructurePdfInput { courseId: string; relPath: string; expectedRevision: string; pages: PdfPageRecipe[] }
export interface RestructurePdfResult { documentRevision: string; fingerprint: string; pageCount: number; pageMap: number[][] }
export interface LegacyNoteMapping { boardId: string; materialId: string; relPath: string; sourceRevision: string }
export interface LegacyNoteMigrationResult { migrated: LegacyNoteMapping[]; failed: Array<{ boardId: string; message: string }> }
