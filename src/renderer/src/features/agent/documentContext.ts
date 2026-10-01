import type { MaterialContext } from '../../../../shared/types/chatContext'
const readers = new Map<string, () => MaterialContext>()
export function registerDocumentContext(id: string, read: () => MaterialContext): () => void { readers.set(id, read); return () => { if (readers.get(id) === read) readers.delete(id) } }
export function readDocumentContexts(): MaterialContext[] { return [...readers.values()].map(read => read()) }
