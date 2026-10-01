import { create } from 'zustand'
import type { ChatAttachment } from '../../../../shared/types/chat'
import type { ChatContext, ChatSkill, CreationKind } from '../../../../shared/types/chatCapabilities'
export interface DraftFile { name: string; path?: string; relPath?: string }
export interface ComposerDraft {
  excludeCurrentMaterial?: boolean
  quotes?: import('./chatPromptBus').ChatQuote[]
  text: string; images: ChatAttachment[]; files: DraftFile[]; skills: ChatSkill[]
  creation: CreationKind | null; browser: boolean; screen: boolean
}
const empty: ComposerDraft = { text: '', images: [], files: [], skills: [], creation: null, browser: false, screen: false }
export const useComposerDraftStore = create<{ drafts: Record<string, ComposerDraft> }>(() => ({ drafts: {} }))
export function useComposerDraft(id: string): ComposerDraft { return useComposerDraftStore((store) => store.drafts[id] ?? empty) }
export function updateComposerDraft(id: string, update: Partial<ComposerDraft> | ((draft: ComposerDraft) => Partial<ComposerDraft>)): void {
  let patch: Partial<ComposerDraft> = {}
  useComposerDraftStore.setState((store) => {
    const draft = store.drafts[id] ?? empty
    patch = typeof update === 'function' ? update(draft) : update
    return { drafts: { ...store.drafts, [id]: { ...draft, ...patch } } }
  })
  draftChannel?.postMessage({ kind: 'patch', id, patch })
}
export function draftContext(draft: ComposerDraft): ChatContext {
  return { ...(draft.excludeCurrentMaterial ? { excludeCurrentMaterial: true } : {}), files: draft.files.flatMap((file) => file.relPath ? [{ name: file.name, relPath: file.relPath }] : []), skillIds: draft.skills.map((skill) => skill.id), skillNames: draft.skills.map((skill) => skill.name), ...(draft.creation ? { creation: draft.creation } : {}), browser: draft.browser, screen: draft.screen }
}

// Drafts are shared across renderer windows without persisting images to disk.
const draftChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bandal-composer-v2') : null
if (draftChannel) {
  draftChannel.onmessage = ({ data }) => {
    if (data.kind === 'hello') draftChannel.postMessage({ kind: 'snapshot', drafts: useComposerDraftStore.getState().drafts })
    if (data.kind === 'snapshot') useComposerDraftStore.setState(store => ({ drafts: { ...data.drafts, ...store.drafts } }))
    if (data.kind === 'patch' && typeof data.id === 'string') useComposerDraftStore.setState(store => ({ drafts: { ...store.drafts, [data.id]: { ...(store.drafts[data.id] ?? empty), ...data.patch } } }))
  }
  draftChannel.postMessage({ kind: 'hello' })
}
