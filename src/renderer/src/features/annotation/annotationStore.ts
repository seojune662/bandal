import { create } from 'zustand'
import type { AnnotationMode, AnnotationReference } from '../../../../shared/types/chatAnnotation'
import { MAX_ANNOTATION_REFERENCES, sanitizeAnnotationReferences } from '../../../../shared/types/chatAnnotation'
import { updateComposerDraft } from '../chat/composerDraftStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export interface AnnotationSession { id: string; conversationId: string; courseId: string; workspaceKey: string | null; mode: AnnotationMode }
interface AnnotationState { session: AnnotationSession | null; busy: boolean; error: string | null; begin: (conversationId: string, courseId: string, mode?: AnnotationMode) => void; stop: () => void; mode: (mode: AnnotationMode) => void }
export const useAnnotationStore = create<AnnotationState>((set) => ({
  session: null, busy: false, error: null,
  begin: (conversationId, courseId, mode = 'element') => set({ session: { id: crypto.randomUUID(), conversationId, courseId, workspaceKey: useWorkspaceStore.getState().activeWorkspaceKey, mode }, busy: false, error: null }),
  stop: () => set({ session: null, busy: false, error: null }),
  mode: mode => set(state => ({ session: state.session ? { ...state.session, id: crypto.randomUUID(), mode } : null, busy: false, error: null }))
}))

/** Selection never sends a message. It appends to the conversation captured at start. */
export function appendAnnotation(session: AnnotationSession, reference: AnnotationReference): void {
  if (useAnnotationStore.getState().session?.id !== session.id) return
  const [validated] = sanitizeAnnotationReferences([{ ...reference, ...(session.workspaceKey ? { workspaceKey: session.workspaceKey } : {}) }])
  if (!validated) return
  updateComposerDraft(session.conversationId, current => {
    const references = current.references ?? []
    if (references.length >= MAX_ANNOTATION_REFERENCES) { useAnnotationStore.setState({ error: '선택한 부분은 한 번에 20개까지 첨부할 수 있어요.' }); return {} }
    if (references.some(item => item.sourcePanelId === reference.sourcePanelId && item.documentEpoch === reference.documentEpoch && item.quote === reference.quote && JSON.stringify(item.rect) === JSON.stringify(reference.rect))) return {}
    return { references: [...references, validated] }
  })
}
