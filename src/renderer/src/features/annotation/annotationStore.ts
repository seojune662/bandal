import { create } from 'zustand'
import type { AnnotationMode, AnnotationReference } from '../../../../shared/types/chatAnnotation'
import { MAX_ANNOTATION_REFERENCES, sanitizeAnnotationReferences } from '../../../../shared/types/chatAnnotation'
import { updateComposerDraft } from '../chat/composerDraftStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export interface AnnotationSession { id: string; conversationId: string; courseId: string; workspaceKey: string | null; mode: AnnotationMode }
interface AnnotationState {
  session: AnnotationSession | null
  busy: boolean
  error: string | null
  pending: Record<string, number>
  captureErrors: Record<string, string>
  begin: (conversationId: string, courseId: string, mode?: AnnotationMode) => void
  stop: () => void
  mode: (mode: AnnotationMode) => void
}
export const useAnnotationStore = create<AnnotationState>((set) => ({
  session: null, busy: false, error: null, pending: {}, captureErrors: {},
  begin: (conversationId, courseId, mode = 'element') => set(state => ({ session: { id: crypto.randomUUID(), conversationId, courseId, workspaceKey: useWorkspaceStore.getState().activeWindowKey ?? useWorkspaceStore.getState().activeWorkspaceKey, mode }, busy: false, error: null, captureErrors: { ...state.captureErrors, [conversationId]: '' } })),
  // Ending the picker does not revoke captures already accepted from its user clicks.
  stop: () => set({ session: null, busy: false, error: null }),
  mode: mode => set(state => ({ session: state.session ? { ...state.session, id: crypto.randomUUID(), mode } : null, busy: false, error: null }))
}))

export interface AnnotationCapture {
  append: (reference: AnnotationReference) => void
  image: (referenceId: string, imageDataUrl: string) => void
  fail: (error: unknown) => void
  finish: () => void
}

/** Only a live picker can admit work. Its token stays bound to the original draft
 * after Finish, Escape, a mode change, or a workspace switch. Finished tokens and
 * arbitrary old sessions cannot append anything. */
export function beginAnnotationCapture(session: AnnotationSession): AnnotationCapture | null {
  if (useAnnotationStore.getState().session?.id !== session.id) return null
  let finished = false
  const delivered = new Set<string>()
  const conversationId = session.conversationId
  useAnnotationStore.setState(state => ({ pending: { ...state.pending, [conversationId]: (state.pending[conversationId] ?? 0) + 1 } }))
  const fail = (error: unknown): void => {
    if (!finished) useAnnotationStore.setState(state => ({ captureErrors: { ...state.captureErrors, [conversationId]: error instanceof Error ? error.message : '선택한 부분의 이미지를 추가하지 못했어요.' } }))
  }
  return {
    append: reference => {
      if (finished) return
      const [validated] = sanitizeAnnotationReferences([{ ...reference, ...(session.workspaceKey ? { workspaceKey: session.workspaceKey } : {}) }])
      if (!validated || delivered.has(validated.id)) return
      delivered.add(validated.id)
      updateComposerDraft(conversationId, current => {
        const references = current.references ?? []
        if (references.length >= MAX_ANNOTATION_REFERENCES) { fail(new Error('선택한 부분은 한 번에 20개까지 첨부할 수 있어요.')); return {} }
        if (references.some(item => item.sourcePanelId === reference.sourcePanelId && item.documentEpoch === reference.documentEpoch && item.quote === reference.quote && JSON.stringify(item.rect) === JSON.stringify(reference.rect))) return {}
        return { references: [...references, validated] }
      })
    },
    image: (referenceId, imageDataUrl) => {
      if (finished) return
      updateComposerDraft(conversationId, current => ({ references: (current.references ?? []).map(reference => reference.id === referenceId ? sanitizeAnnotationReferences([{ ...reference, imageDataUrl }])[0]! : reference) }))
    },
    fail,
    finish: () => {
      if (finished) return
      finished = true
      useAnnotationStore.setState(state => ({ pending: { ...state.pending, [conversationId]: Math.max(0, (state.pending[conversationId] ?? 1) - 1) } }))
    }
  }
}

/** Sending closes new selection input, then waits for accepted host/native work.
 * The caller must read the draft again afterwards to include the last drain. */
export async function finishAnnotationSelection(conversationId: string): Promise<void> {
  if (useAnnotationStore.getState().session?.conversationId === conversationId) useAnnotationStore.getState().stop()
  if (!(useAnnotationStore.getState().pending[conversationId] ?? 0)) return
  await new Promise<void>(resolve => {
    const unsubscribe = useAnnotationStore.subscribe(state => {
      if ((state.pending[conversationId] ?? 0) > 0) return
      unsubscribe(); resolve()
    })
  })
}
