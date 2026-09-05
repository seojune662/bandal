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

/**
 * Appearance knobs beyond theme × palette. All three are pure CSS switches
 * (src/shared/appearance.ts): `fontScale` multiplies the root font-size so
 * every rem token follows, `editorFont` swaps the note editor's family only
 * (chrome stays Pretendard), `density` tightens the spacing/radius/chrome
 * tokens.
 */
export const FONT_SCALES = [0.9, 1, 1.1, 1.2] as const
export type FontScale = (typeof FONT_SCALES)[number]
export const DEFAULT_FONT_SCALE: FontScale = 1

export function isFontScale(value: unknown): value is FontScale {
  return FONT_SCALES.some((scale) => scale === value)
}

export const EDITOR_FONTS = ['sans', 'serif', 'mono'] as const
export type EditorFont = (typeof EDITOR_FONTS)[number]
export const DEFAULT_EDITOR_FONT: EditorFont = 'sans'

export function isEditorFont(value: unknown): value is EditorFont {
  return EDITOR_FONTS.some((font) => font === value)
}

export const DENSITIES = ['comfortable', 'compact'] as const
export type Density = (typeof DENSITIES)[number]
export const DEFAULT_DENSITY: Density = 'comfortable'

export function isDensity(value: unknown): value is Density {
  return DENSITIES.some((density) => density === value)
}

/** 마감 알림을 며칠 전에 보낼지. 사용자는 이 중 여러 개를 고를 수 있다. */
export const DEADLINE_LEAD_DAYS = [1, 3, 7] as const
export type DeadlineLeadDays = (typeof DEADLINE_LEAD_DAYS)[number]

export function isDeadlineLeadDays(value: unknown): value is DeadlineLeadDays {
  return DEADLINE_LEAD_DAYS.some((days) => days === value)
}

/**
 * [v0.37] OS 알림. `enabled`가 마스터, 나머지는 이벤트별 스위치다.
 * `sent`는 내부용 — 이미 보낸 마감 알림 키(`<taskId>:<leadDays>`) → ISO
 * 발송 시각. 같은 과제·같은 리드일로 두 번 알리지 않기 위한 장부이며
 * 설정 UI에는 노출하지 않는다. 90일 지난 항목은 스케줄러가 정리한다.
 */
export interface NotificationSettings {
  enabled: boolean
  deadlines: boolean
  deadlineLeadDays: readonly DeadlineLeadDays[]
  agentComplete: boolean
  downloads: boolean
  pluginNotices: boolean
  sound: boolean
  suppressWhileFocused: boolean
  sent: Record<string, string>
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  deadlines: true,
  deadlineLeadDays: [3, 1],
  agentComplete: true,
  downloads: true,
  pluginNotices: true,
  sound: true,
  suppressWhileFocused: true,
  sent: {}
}

/** 노트·채팅·자료의 http(s) 링크를 어디서 여는가. ⇧⌘클릭은 항상 시스템 브라우저. */
export type LinkRouting = 'in-app' | 'system'

export function isLinkRouting(value: unknown): value is LinkRouting {
  return value === 'in-app' || value === 'system'
}

/**
 * [v0.37] 브라우저 설정. `browserSearchEngine`은 역사적 이유로 최상위에 남는다.
 * - `agentUse`: 에이전트 브라우저 사용 마스터 스위치. false면 사이트별 권한
 *   (grant) 목록은 보존하되 browser_* 도구가 전부 거부된다.
 * - `homePage`: 새 브라우저 탭이 여는 URL. ''이면 새 탭 페이지.
 * - `defaultZoomLevel`: 새 탭의 줌 레벨. src/shared/browserZoom.ts 의 스톱만 허용.
 */
export interface BrowserSettings {
  agentUse: boolean
  homePage: string
  defaultZoomLevel: number
  linkRouting: LinkRouting
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  agentUse: true,
  homePage: '',
  defaultZoomLevel: 0,
  linkRouting: 'in-app'
}

/**
 * 웹뷰 안에서 단축키를 누가 먼저 받는가.
 * - `bandal`: 지금까지의 동작. guestAllowed 액션 전부를 반달이 가로챈다.
 * - `site`: 탭 수명(새 탭·닫기·탭 전환·다시 열기)만 반달이 받고, 브라우저
 *   크롬 단축키(새로고침·찾기·줌·주소창·즐겨찾기·뒤로/앞으로)는 페이지가 받는다.
 */
export type ShortcutPriority = 'bandal' | 'site'

export function isShortcutPriority(value: unknown): value is ShortcutPriority {
  return value === 'bandal' || value === 'site'
}

/**
 * [v0.37] 실험실 플래그. 새 하위 시스템의 킬 스위치다. 플래그가 졸업하면
 * 여기서 지우고 sanitizer 가 옛 키를 버린다.
 * - `extensionRuntime`: 확장 플러그인 런타임(utilityProcess 호스트). false면
 *   런타임을 띄우지 않고 플러그인 패널이 안내만 보여 준다.
 * - `orbCharms`: 오브 참(장식) 선택 UI. false면 외관 패널에서 숨기고 none 으로 그린다.
 */
export const EXPERIMENTAL_FLAGS = ['extensionRuntime', 'orbCharms'] as const
export type ExperimentalFlag = (typeof EXPERIMENTAL_FLAGS)[number]
export type ExperimentalSettings = Record<ExperimentalFlag, boolean>

export const DEFAULT_EXPERIMENTAL: ExperimentalSettings = {
  extensionRuntime: true,
  orbCharms: true
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
  /** Root font-size multiplier (settings > 화면 > 글자 크기). */
  fontScale: FontScale
  /** Note editor body family; the chrome never follows it. */
  editorFont: EditorFont
  /** Spacing/radius/chrome tightness. */
  density: Density
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
  /** [v0.37] OS 알림. */
  notifications: NotificationSettings
  /** [v0.37] 브라우저 동작(홈페이지·기본 줌·링크 라우팅·에이전트 사용). */
  browser: BrowserSettings
  /** [v0.37] 웹뷰 안 단축키 우선권. */
  shortcutPriority: ShortcutPriority
  /** [v0.37] 실험실 플래그. */
  experimental: ExperimentalSettings
  /**
   * [v0.40] 플러그인 카탈로그 추가 소스(index.json 의 https URL). 공식 소스
   * (OFFICIAL_CATALOG_URL)는 항상 포함되며 여기엔 넣지 않는다.
   */
  pluginSources: readonly string[]
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME_ID,
  palette: DEFAULT_PALETTE_ID,
  fontScale: DEFAULT_FONT_SCALE,
  editorFont: DEFAULT_EDITOR_FONT,
  density: DEFAULT_DENSITY,
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
  orbCharm: DEFAULT_ORB_CHARM,
  notifications: DEFAULT_NOTIFICATIONS,
  browser: DEFAULT_BROWSER_SETTINGS,
  shortcutPriority: 'bandal',
  experimental: DEFAULT_EXPERIMENTAL,
  pluginSources: []
}

export type SettingsPatch = Partial<Settings>
