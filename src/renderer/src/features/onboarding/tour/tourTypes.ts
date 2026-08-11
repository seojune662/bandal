import type { ReactNode } from 'react'

export type TourAnchorKey =
  | 'course-sidebar'
  | 'materials-import'
  | 'tab-strip'
  | 'favorites-section'
  | 'assistant-panel'
  | 'assistant-orb'

export type TourPlacement = 'top' | 'right' | 'bottom' | 'left'

export type TourBeforeAction =
  | 'open-seed-note'
  | 'reveal-favorites'
  | 'open-assistant'

export interface TourStep {
  id: string
  target: TourAnchorKey | null
  placement: TourPlacement
  title: string
  body: ReactNode
  before: TourBeforeAction | null
  nextLabel: string | null
}

export interface TourAnchorRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}
