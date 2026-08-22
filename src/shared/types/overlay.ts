import type { AssistantMode } from './settings'

export type OverlayView = 'orb' | 'popup'

export type ScreenPermissionState =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'unsupported'

export interface OverlayState {
  mode: AssistantMode
  courseId: string | null
  conversationId: string | null
  popupOpen: boolean
  desktopVisible: boolean
  screenPermission: ScreenPermissionState
}

export interface OverlayPrompt {
  conversationId: string
  prompt: string
}
