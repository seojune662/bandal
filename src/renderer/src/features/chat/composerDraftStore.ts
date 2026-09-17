import { create } from 'zustand'
import type { ChatAttachment } from '../../../../shared/types/chat'
import type { ChatContext, ChatSkill, CreationKind } from '../../../../shared/types/chatCapabilities'
export interface DraftFile { name: string; path?: string; relPath?: string }
export interface ComposerDraft {
  text: string; images: ChatAttachment[]; files: DraftFile[]; skills: ChatSkill[]
  creation: CreationKind | null; browser: boolean; screen: boolean
}
const empty: ComposerDraft = { text: '', images: [], files: [], skills: [], creation: null, browser: false, screen: false }
export const useComposerDraftStore = create<{ drafts: Record<string, ComposerDraft> }>(() => ({ drafts: {} }))
export function useComposerDraft(id: string): ComposerDraft { return useComposerDraftStore((store) => store.drafts[id] ?? empty) }
export function updateComposerDraft(id: string, update: Partial<ComposerDraft> | ((draft: ComposerDraft) => Partial<ComposerDraft>)): void {
  useComposerDraftStore.setState((store) => {
    const draft = store.drafts[id] ?? empty
    return { drafts: { ...store.drafts, [id]: { ...draft, ...(typeof update === 'function' ? update(draft) : update) } } }
  })
}
export function draftContext(draft: ComposerDraft): ChatContext {
  return { files: draft.files.flatMap((file) => file.relPath ? [{ name: file.name, relPath: file.relPath }] : []), skillIds: draft.skills.map((skill) => skill.id), skillNames: draft.skills.map((skill) => skill.name), ...(draft.creation ? { creation: draft.creation } : {}), browser: draft.browser, screen: draft.screen }
}
