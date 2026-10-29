import type { ContentSearchIndexStatus } from '../../../shared/types/search'
export interface PdfSearchRequest { dbPath: string; courseId: string; folder: string; rootRelPath: string }
export interface PdfSearchMessage { id: number; status: ContentSearchIndexStatus; done?: boolean }
export const emptySearchIndexStatus = (): ContentSearchIndexStatus => ({ phase: 'idle', processedFiles: 0, totalFiles: 0, indexedPages: 0, failures: [] })
