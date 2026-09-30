export interface AssistantWindowState {
  visible: boolean
  courseId: string | null
  conversationId: string | null
}
export interface AssistantPrompt { text?: string; quote?: { text: string; source: string } }
export type AssistantWindowRequest =
  | { action: 'get' | 'close' }
  | { action: 'sync'; state: AssistantWindowState; geometry?: { x: number; y: number; width: number; height: number } }
  | { action: 'prompt'; conversationId: string; prompt: AssistantPrompt }
