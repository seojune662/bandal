import { create } from 'zustand'
import { useEffect } from 'react'
import { composerDraftPersistence } from './composerDraftPersistence'
import type { ChatAttachment } from '../../../../shared/types/chat'
import type { ChatContext, ChatSkill, CreationKind } from '../../../../shared/types/chatCapabilities'
export interface DraftFile { name: string; path?: string; relPath?: string }
export interface ComposerDraft {
  references?: import('../../../../shared/types/chatAnnotation').AnnotationReference[]
  excludeCurrentMaterial?: boolean
  quotes?: import('./chatPromptBus').ChatQuote[]
  text: string; images: ChatAttachment[]; files: DraftFile[]; skills: ChatSkill[]
  creation: CreationKind | null; browser: boolean; screen: boolean
}
const empty: ComposerDraft = { text: '', images: [], files: [], skills: [], creation: null, browser: false, screen: false }
export const useComposerDraftStore = create<{ drafts: Record<string, ComposerDraft>; hydrated: Record<string, boolean>; persistenceErrors: Record<string, string | undefined> }>(() => ({ drafts: {}, hydrated: {}, persistenceErrors: {} }))
const hydrating = new Map<string, Promise<void>>()
type DraftUpdate = Partial<ComposerDraft> | ((draft: ComposerDraft) => Partial<ComposerDraft>)
const dirtyBeforeHydration = new Map<string, DraftUpdate[]>()
function queueBeforeHydration(id: string, update: DraftUpdate): void {
  dirtyBeforeHydration.set(id, [...dirtyBeforeHydration.get(id) ?? [], update])
}
const writes = new Map<string, Promise<void>>()
export function hydrateComposerDraft(id: string): Promise<void> {
  if (useComposerDraftStore.getState().hydrated[id]) return Promise.resolve()
  const current = hydrating.get(id)
  if (current) return current
  const task = composerDraftPersistence.read(id).then(saved => {
    const updates = dirtyBeforeHydration.get(id) ?? []
    const draft = updates.reduce<ComposerDraft>((current, update) => ({ ...current, ...(typeof update === 'function' ? update(current) : update) }), { ...empty, ...saved })
    useComposerDraftStore.setState(store => ({
      drafts: { ...store.drafts, [id]: draft },
      hydrated: { ...store.hydrated, [id]: true }, persistenceErrors: { ...store.persistenceErrors, [id]: undefined }
    }))
    dirtyBeforeHydration.delete(id)
    if (updates.length) draftChannel?.postMessage({ kind: 'patch', id, patch: draft })
  }).catch(() => {
    useComposerDraftStore.setState(store => ({ persistenceErrors: { ...store.persistenceErrors, [id]: '저장한 초안을 불러오지 못했어요. 다시 불러온 뒤 전송해 주세요.' } }))
  }).finally(() => { hydrating.delete(id) })
  hydrating.set(id, task)
  return task
}
function persistComposerDraft(id: string): void {
  const task = (writes.get(id) ?? Promise.resolve()).then(() => hydrateComposerDraft(id)).then(async () => {
    const store = useComposerDraftStore.getState()
    if (!store.hydrated[id]) return
    try {
      await composerDraftPersistence.write(id, store.drafts[id] ?? empty)
      useComposerDraftStore.setState(current => ({ persistenceErrors: { ...current.persistenceErrors, [id]: undefined } }))
    } catch { useComposerDraftStore.setState(current => ({ persistenceErrors: { ...current.persistenceErrors, [id]: '초안을 기기에 저장하지 못했어요. 앱을 닫기 전에 다시 시도해 주세요.' } })) }
  }).finally(() => { if (writes.get(id) === task) writes.delete(id) })
  writes.set(id, task)
}
export async function flushComposerDraft(id: string): Promise<void> { await writes.get(id) }
export function useComposerDraft(id: string): ComposerDraft {
  useEffect(() => { void hydrateComposerDraft(id) }, [id])
  return useComposerDraftStore((store) => store.drafts[id] ?? empty)
}
export function updateComposerDraft(id: string, update: DraftUpdate): void {
  let patch: Partial<ComposerDraft> = {}
  useComposerDraftStore.setState((store) => {
    const draft = store.drafts[id] ?? empty
    patch = typeof update === 'function' ? update(draft) : update
    if (!store.hydrated[id]) queueBeforeHydration(id, update)
    return { drafts: { ...store.drafts, [id]: { ...draft, ...patch } } }
  })
  if (useComposerDraftStore.getState().hydrated[id]) draftChannel?.postMessage({ kind: 'patch', id, patch })
  persistComposerDraft(id)
}

/** Remove the submitted snapshot without discarding newer edits from another composer. */
export function consumeComposerDraft(id: string, sent: ComposerDraft): void {
  const remaining = <T,>(current: T[], submitted: T[]): T[] => {
    const counts = new Map<string, number>()
    for (const item of submitted) { const key = JSON.stringify(item); counts.set(key, (counts.get(key) ?? 0) + 1) }
    return current.filter(item => {
      const key = JSON.stringify(item), count = counts.get(key) ?? 0
      if (count === 0) return true
      counts.set(key, count - 1)
      return false
    })
  }
  updateComposerDraft(id, current => ({
    text: current.text === sent.text ? '' : current.text,
    quotes: remaining(current.quotes ?? [], sent.quotes ?? []),
    references: remaining(current.references ?? [], sent.references ?? []),
    images: remaining(current.images, sent.images),
    files: remaining(current.files, sent.files),
    skills: remaining(current.skills, sent.skills),
    creation: current.creation === sent.creation ? null : current.creation,
    browser: sent.browser ? false : current.browser,
    screen: sent.screen ? false : current.screen
  }))
}
export function draftContext(draft: ComposerDraft): ChatContext {
  return { references: draft.references ?? [], ...(draft.excludeCurrentMaterial ? { excludeCurrentMaterial: true } : {}), files: draft.files.flatMap((file) => file.relPath ? [{ name: file.name, relPath: file.relPath }] : []), skillIds: draft.skills.map((skill) => skill.id), skillNames: draft.skills.map((skill) => skill.name), ...(draft.creation ? { creation: draft.creation } : {}), browser: draft.browser, screen: draft.screen }
}

// Share live edits across windows; IndexedDB also restores unsent snapshots after restart.
const draftChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bandal-composer-v2') : null
if (draftChannel) {
  draftChannel.onmessage = ({ data }) => {
    if (data.kind === 'hello') draftChannel.postMessage({ kind: 'snapshot', drafts: useComposerDraftStore.getState().drafts })
    if (data.kind === 'snapshot') {
      for (const [id, draft] of Object.entries(data.drafts as Record<string, ComposerDraft>)) {
        if (useComposerDraftStore.getState().drafts[id]) continue
        queueBeforeHydration(id, draft)
        useComposerDraftStore.setState(store => ({ drafts: { ...store.drafts, [id]: draft } }))
        persistComposerDraft(id)
      }
    }
    if (data.kind === 'patch' && typeof data.id === 'string') {
      if (!useComposerDraftStore.getState().hydrated[data.id]) queueBeforeHydration(data.id, data.patch)
      useComposerDraftStore.setState(store => ({ drafts: { ...store.drafts, [data.id]: { ...(store.drafts[data.id] ?? empty), ...data.patch } } }))
      persistComposerDraft(data.id)
    }
  }
  draftChannel.postMessage({ kind: 'hello' })
}
