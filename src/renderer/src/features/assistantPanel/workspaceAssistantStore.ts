import { create } from 'zustand'
import { workspaceKey, type WorkspaceRef } from '../../../../shared/types/workspace'

export type AssistantMode = 'chat' | 'quiz' | 'flashcards' | 'exam-predictions'
export interface WorkspaceConversation { conversationId: string; mode: AssistantMode }
const PREFIX = 'bandal:workspace-assistant:v2:'
const storageKey = (key: string): string => PREFIX + encodeURIComponent(key)
function parse(value: string | null): WorkspaceConversation | undefined {
  try {
    const item = JSON.parse(value ?? 'null')
    return item && typeof item.conversationId === 'string' && ['chat', 'quiz', 'flashcards', 'exam-predictions'].includes(item.mode) ? item : undefined
  } catch { return undefined }
}
function stored(key: string): WorkspaceConversation | undefined {
  try { return parse(localStorage.getItem(storageKey(key))) } catch { return undefined }
}
function save(key: string, value: WorkspaceConversation | null): boolean {
  try { if (value) localStorage.setItem(storageKey(key), JSON.stringify(value)); else localStorage.removeItem(storageKey(key)); return true } catch { return false }
}
function initialSpaces(): Record<string, WorkspaceConversation> {
  const spaces: Record<string, WorkspaceConversation> = {}
  try {
    // Migrate the old whole-map format once. Existing v2 keys always win.
    const legacy = JSON.parse(localStorage.getItem('bandal-workspace-assistant-v1') ?? 'null')?.state?.spaces ?? {}
    let migrated = true
    for (const [key, value] of Object.entries(legacy)) {
      const valid = parse(JSON.stringify(value))
      if (!valid) continue
      spaces[key] = stored(key) ?? valid
      if (!stored(key) && !save(key, valid)) migrated = false
    }
    if (migrated) localStorage.removeItem('bandal-workspace-assistant-v1')
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith(PREFIX)) continue
      const value = parse(localStorage.getItem(key))
      if (value) spaces[decodeURIComponent(key.slice(PREFIX.length))] = value
    }
  } catch { /* Storage is optional in isolated renderers and tests. */ }
  return spaces
}
export const useWorkspaceAssistantStore = create<{
  spaces: Record<string, WorkspaceConversation>
  select(workspace: WorkspaceRef, conversationId?: string): string
  setMode(workspace: WorkspaceRef, mode: AssistantMode): void
  moveWorkspace(from: WorkspaceRef, to: WorkspaceRef): void
}>((set, get) => ({
  spaces: initialSpaces(),
  select(workspace, conversationId) {
    const key = workspaceKey(workspace), previous = stored(key) ?? get().spaces[key]
    const id = conversationId ?? previous?.conversationId ?? crypto.randomUUID()
    const value = previous?.conversationId === id ? previous : { conversationId: id, mode: 'chat' as const }
    save(key, value)
    if (get().spaces[key]?.conversationId !== value.conversationId || get().spaces[key]?.mode !== value.mode) set(state => ({ spaces: { ...state.spaces, [key]: value } }))
    return id
  },
  moveWorkspace(from, to) {
    const previousKey = workspaceKey(from), nextKey = workspaceKey(to)
    if (previousKey === nextKey) return
    const previous = stored(previousKey) ?? get().spaces[previousKey]
    if (!previous || save(nextKey, previous)) save(previousKey, null)
    set(state => { const spaces = { ...state.spaces }; delete spaces[previousKey]; if (previous) spaces[nextKey] = previous; return { spaces } })
  },
  setMode(workspace, mode) {
    const key = workspaceKey(workspace), conversationId = get().select(workspace), value = { conversationId, mode }
    save(key, value)
    set(state => ({ spaces: { ...state.spaces, [key]: value } }))
  }
}))
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (!event.key?.startsWith(PREFIX)) return
  try {
    const key = decodeURIComponent(event.key.slice(PREFIX.length)), value = parse(event.newValue)
    useWorkspaceAssistantStore.setState(state => { const spaces = { ...state.spaces }; if (value) spaces[key] = value; else delete spaces[key]; return { spaces } })
  } catch { /* Ignore malformed unrelated storage events. */ }
})
