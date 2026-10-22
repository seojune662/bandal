import type { ComposerDraft } from './composerDraftStore'

// IndexedDB stores image snapshots without localStorage's small quota. Each
// conversation is an independent record so windows cannot replace other drafts.
let database: Promise<IDBDatabase | null> | null = null
function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('bandal-composer-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null }
      resolve(request.result)
    }
    request.onerror = () => { database = null; reject(request.error) }
    request.onblocked = () => { database = null; reject(new Error('다른 반달 창에서 초안 저장소를 사용 중이에요.')) }
  })
}
export const composerDraftPersistence = {
  async read(id: string): Promise<ComposerDraft | undefined> {
    const db = await openDatabase()
    if (!db) return undefined
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readonly')
      const request = transaction.objectStore('drafts').get(id)
      request.onsuccess = () => resolve(request.result as ComposerDraft | undefined)
      request.onerror = () => reject(request.error)
    })
  },
  async write(id: string, draft: ComposerDraft): Promise<void> {
    const db = await openDatabase()
    if (!db) return
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite', { durability: 'strict' })
      transaction.objectStore('drafts').put(draft, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('초안 저장이 중단됐어요.'))
    })
  }
}
