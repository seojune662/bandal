/**
 * App settings persisted by the main process (JSON in userData).
 */

import { DEFAULT_ORB_CHARM } from '../orbCharm'
import type { OrbCharmId } from '../orbCharm'
import type { AgentProvider } from './agent-events'
import { DEFAULT_PALETTE_ID, DEFAULT_THEME_ID } from '../theme'
import { DEFAULT_SEARCH_ENGINE, type SearchEngineId } from '../search'
import type { PaletteId, ThemeId } from '../theme'
import { DEFAULT_UNIVERSITY_SETTINGS } from './university'
import type { UniversitySettings } from './university'

/**
 * A theme id from the registry (src/shared/theme.ts) or `system`, which
 * follows the OS between the two 반달 defaults. Adding a theme widens this
 * union automatically — there is no theme name spelled out here.
 */
export type ThemePreference = ThemeId | 'system'

export type AssistantMode = 'in-app' | 'desktop'

/** 데스크톱 오브 동작. 나중에 hotkey 등을 덧붙일 수 있게 객체로 둔다. */
export interface DesktopOrbSettings {
  keepAliveOnClose: boolean
}

export const DEFAULT_DESKTOP_ORB: DesktopOrbSettings = {
  keepAliveOnClose: true
}

/**
 * [M6-A] Versioned first-run onboarding state.
 *
 * - `flowVersion` is the wizard revision the user last saw. Bumping
 *   ONBOARDING_FLOW_VERSION re-opens the wizard once for existing users.
 * - `closedAt` is the ISO timestamp of dismissal/completion; `null` means
 *   the wizard should show. It is only ever reset deliberately
 *   (설정 > General > "온보딩 다시 보기") — never automatically.
 * - `lastCompletedStep` counts finished steps (0 = none, 3 = all), so a
 *   re-opened wizard can resume where the user left off.
 */
export interface OnboardingState {
  flowVersion: number
  closedAt: string | null
  lastCompletedStep: number
}

/**
 * v2 [M8] inserted 학교 고르기 as step ②. Bumping this re-opens the wizard
 * once for existing users so they get asked which school they attend.
 */
export const ONBOARDING_FLOW_VERSION = 2

export const DEFAULT_ONBOARDING: OnboardingState = {
  flowVersion: ONBOARDING_FLOW_VERSION,
  closedAt: null,
  lastCompletedStep: 0
}

/**
 * [R3] Interactive guided tour (임시 과목을 만들어 실제 UI를 짚는 둘러보기).
 *
 * - `seenVersion` is the TUTORIAL_VERSION the user last acknowledged
 *   (started OR declined). 0 = never offered. Raising TUTORIAL_VERSION
 *   shows the one-time corner prompt again for existing users.
 * - `activeCourseId` is non-null only while a tour's temp course exists.
 *   It is written BEFORE seeding so a crash mid-tour can be repaired on
 *   the next boot (delete + purge the leftover course).
 */
export interface TutorialState {
  seenVersion: number
  activeCourseId: string | null
}

export const TUTORIAL_VERSION = 1

export const DEFAULT_TUTORIAL: TutorialState = {
  seenVersion: 0,
  activeCourseId: null
}

export interface Milestones {
  /** First successful use of picture-in-picture, as an ISO timestamp. */
  pipUsedAt: string | null
}

export const DEFAULT_MILESTONES: Milestones = {
  pipUsedAt: null
}

export interface Settings {
  theme: ThemePreference
  /**
   * The color family layered over `theme` (src/shared/theme.ts). Independent
   * of `system`: the OS picks the mode, this picks the hue. Absent in files
   * written before v0.15, which sanitize to the 반달 default.
   */
  palette: PaletteId
  /** Preferred AI agent provider. */
  agentProvider: AgentProvider
  /** Where the assistant is presented. */
  assistantMode: AssistantMode
  /** Desktop assistant-orb behavior. */
  desktopOrb: DesktopOrbSettings
  /** Root folder for course data. Defaults to ~/Documents/Bandal. */
  dataRoot: string
  /** UI language (BCP 47). */
  locale: string
  /** [M6-A] First-run onboarding progress. */
  onboarding: OnboardingState
  /** [R3] Guided-tour progress and crash-safety marker. */
  tutorial: TutorialState
  /** User overrides keyed by src/shared/keymap.ts action id. null = unbound. */
  keybindings: Record<string, string | null>
  /** One-time product milestones. */
  milestones: Milestones
  /** [M8] Chosen school + the user layer over its preset shortcuts. */
  university: UniversitySettings
  /**
   * [R3] 새 자료 탭을 지금 보고 있는 탭 바로 옆(같은 그룹, 다음 칸)에 연다.
   * false면 dockview 기본 동작대로 활성 그룹의 끝에 붙는다.
   */
  openAdjacentTab: boolean
  /** [R3] 앱을 다시 켰을 때 마지막으로 보던 과목을 복원한다. */
  restoreLastCourse: boolean
  /** 주소창에 URL이 아닌 말을 넣었을 때 쓸 검색 엔진. */
  browserSearchEngine: SearchEngineId
  /**
   * [R3] 내부용 — 마지막으로 선택한 과목 id. 설정 파일에 저장해 창 사이에
   * 자동으로 동기화된다(설정 UI에는 노출하지 않는다). null = 기록 없음.
   */
  lastActiveCourseId: string | null
  /** 반달 AI 오브에 매달리는 장식 테마(src/shared/orbCharm.ts). 기본 none. */
  orbCharm: OrbCharmId
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME_ID,
  palette: DEFAULT_PALETTE_ID,
  agentProvider: 'claude-code',
  assistantMode: 'in-app',
  desktopOrb: DEFAULT_DESKTOP_ORB,
  dataRoot: '',
  locale: 'ko-KR',
  onboarding: DEFAULT_ONBOARDING,
  tutorial: DEFAULT_TUTORIAL,
  keybindings: {},
  milestones: DEFAULT_MILESTONES,
  university: DEFAULT_UNIVERSITY_SETTINGS,
  openAdjacentTab: false,
  restoreLastCourse: true,
  browserSearchEngine: DEFAULT_SEARCH_ENGINE,
  lastActiveCourseId: null,
  orbCharm: DEFAULT_ORB_CHARM
}

export type SettingsPatch = Partial<Settings>
