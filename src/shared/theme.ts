/**
 * The theme registry — the single source of truth for *which* themes exist.
 *
 * A theme is one self-contained token-assignment file in
 * `src/renderer/src/styles/themes/<id>.css` plus one entry in `THEMES` here.
 * Nothing else in the app knows theme names: the picker, the settings
 * validator and the window background all read this list.
 *
 * ### Adding a theme (2 steps, no other file changes)
 * 1. Create `src/renderer/src/styles/themes/<id>.css` — copy an existing file,
 *    (the two original themes keep their historical file names
 *    `dark-navy.css` and `light.css`),
 *    reassign every token, and add its `@import` line to `themes/index.css`.
 *    The file must define BOTH blocks: the `:root` preview-swatch exports
 *    (`--preview-<id>-bg|surface|text|accent`) and the
 *    `:root[data-theme='<id>']` token block.
 * 2. Add one `ThemeDefinition` entry below.
 *
 * `windowBackground` MUST equal the theme's `--bg-app` in sRGB hex: the main
 * process paints the BrowserWindow with it before any CSS loads, so a stale
 * value shows as a flash of the wrong color on launch.
 */

export type ThemeId =
  | 'dark'
  | 'light'
  | 'midnight'
  | 'sepia'
  | 'high-contrast'
  | 'graphite'

/** Which end of the light/dark axis a theme sits on (`color-scheme`). */
export type ThemeBase = 'dark' | 'light'

export interface ThemeDefinition {
  id: ThemeId
  /** Korean display name (설정 > Appearance). */
  name: string
  /** One line: when a student should pick this one. 합니다체 (설정 창 톤). */
  description: string
  base: ThemeBase
  /** Mirrors `--bg-app`. Used for BrowserWindow.backgroundColor. */
  windowBackground: string
}

/**
 * Order here is the order in the picker: the two 반달 defaults first, then
 * the context themes.
 */
export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'dark',
    name: '반달 다크',
    description: '밤하늘 네이비와 문골드. 기본값이며 대부분의 작업에 맞습니다.',
    base: 'dark',
    windowBackground: '#09101e'
  },
  {
    id: 'light',
    name: '반달 라이트',
    description: '아이보리 종이. 밝은 강의실과 낮 시간에 맞습니다.',
    base: 'light',
    windowBackground: '#f9f5ec'
  },
  {
    id: 'midnight',
    name: '자정',
    description: '순수한 검정. 불 끈 방의 야간 학습과 OLED 배터리 절약용입니다.',
    base: 'dark',
    windowBackground: '#000000'
  },
  {
    id: 'sepia',
    name: '세피아',
    description: '따뜻한 종이색. PDF를 오래 읽는 날의 눈부심을 줄입니다.',
    base: 'light',
    windowBackground: '#f0e5d2'
  },
  {
    id: 'high-contrast',
    name: '고대비',
    description: '최대 대비와 또렷한 테두리. 저시력·강한 조명·빔프로젝터용입니다.',
    base: 'light',
    windowBackground: '#ffffff'
  },
  {
    id: 'graphite',
    name: '흑연',
    description: '무채색 집중 모드. UI에서 색을 빼 자료의 색만 남깁니다.',
    base: 'dark',
    windowBackground: '#292929'
  }
] as const

export const DEFAULT_THEME_ID: ThemeId = 'dark'

/** `system` resolves to this pair — the two 반달 defaults. */
export const SYSTEM_THEME: Record<ThemeBase, ThemeId> = {
  dark: 'dark',
  light: 'light'
}

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!
}

/**
 * Background color for a BrowserWindow created *before* the renderer can
 * resolve `system`. `prefersDark` comes from `nativeTheme.shouldUseDarkColors`
 * in the main process.
 */
export function resolveWindowBackground(
  preference: ThemeId | 'system',
  prefersDark: boolean
): string {
  const id =
    preference === 'system'
      ? SYSTEM_THEME[prefersDark ? 'dark' : 'light']
      : preference
  return getTheme(id).windowBackground
}

/**
 * [win32] Caption-button glyph color for `titleBarOverlay` — light glyphs on
 * dark themes, dark glyphs on light themes. Same resolution rules as
 * `resolveWindowBackground`.
 */
export function resolveWindowSymbolColor(
  preference: ThemeId | 'system',
  prefersDark: boolean
): string {
  const id =
    preference === 'system'
      ? SYSTEM_THEME[prefersDark ? 'dark' : 'light']
      : preference
  return getTheme(id).base === 'dark' ? '#f0ede6' : '#1f1a12'
}

/** The resolved (non-`system`) theme actually painted on `<html data-theme>`. */
export type ResolvedTheme = ThemeId
