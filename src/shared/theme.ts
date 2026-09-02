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
 *
 * ### The second axis: palettes
 * A theme id above is a *mode* — it owns the surface ladder, the text ramp,
 * borders and shadows. A `PaletteId` (below) is the *color family* layered on
 * top: it re-tints the accent, and on the three tinted modes
 * (`dark`/`light`/`midnight`) the surfaces too. `<html>` therefore carries
 * both: `data-theme='<mode>' data-palette='<palette>'`.
 *
 * `bandal` is the identity palette — its values ARE the ones written in
 * `themes/<mode>.css`, so it ships no override file. Every other palette is
 * one file in `styles/palettes/<id>.css` with up to six
 * `:root[data-palette='<id>'][data-theme='<mode>']` blocks.
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

/**
 * The color family layered over a mode. `bandal` is the baseline written
 * directly into `themes/*.css`; the rest live in `styles/palettes/<id>.css`.
 */
export type PaletteId =
  | 'bandal'
  | 'ink'
  | 'lavender'
  | 'moss'
  | 'catppuccin'
  | 'minimal'

export interface PaletteDefinition {
  id: PaletteId
  /** Korean display name (설정 > 화면 > 색 계열). */
  name: string
  /** One line: what the family is going for. 합니다체 (설정 창 톤). */
  description: string
  /**
   * `--bg-app` per mode, in sRGB hex — the same contract as a theme's
   * `windowBackground`. Only the three tinted modes differ per palette; the
   * flat ones (`sepia`/`high-contrast`/`graphite`) reuse the mode's own value,
   * so they are absent here and fall back to `THEMES`.
   */
  windowBackground: Partial<Record<ThemeId, string>>
}

/** Order here is the order in the picker. */
export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: 'bandal',
    name: '반달',
    description: '밤하늘 네이비와 문골드. 반달의 기본 색입니다.',
    windowBackground: {}
  },
  {
    id: 'ink',
    name: '흑묵',
    description: '색기 없는 무채 잉크에 절제된 금빛 하나. 화면이 조용해집니다.',
    windowBackground: {
      dark: '#0b0c0e',
      light: '#f6f5f2',
      midnight: '#000000',
      // 흑묵 is the one palette that also re-cuts a flat mode: a greyer sheet
      // than 반달 세피아 (#f0e5d2).
      sepia: '#ece6d8'
    }
  },
  {
    id: 'lavender',
    name: '라벤더',
    description: '차가운 근흑 바탕에 라벤더 액센트. 늦은 밤 작업에 맞습니다.',
    windowBackground: {
      dark: '#0a0911',
      light: '#f6f4f9',
      midnight: '#000000'
    }
  },
  {
    id: 'moss',
    name: '이끼',
    description: '딥 그린 차콜과 세이지. 오래 앉아 읽는 날에 맞습니다.',
    windowBackground: {
      dark: '#0a110d',
      light: '#f2f6f1',
      midnight: '#000000'
    }
  },
  {
    id: 'catppuccin',
    name: '카푸치노',
    description: '카푸치노 모카와 라테. 옵시디언에서 쓰던 색을 그대로 가져옵니다.',
    windowBackground: {
      dark: '#181825',
      light: '#e5e9ef',
      midnight: '#000000'
    }
  },
  {
    id: 'minimal',
    name: '미니멀',
    description: '무채색 표면에 절제된 청회색 액센트. 화면이 가장 조용해집니다.',
    windowBackground: {
      dark: '#161616',
      light: '#f5f5f5',
      midnight: '#000000'
    }
  }
] as const

export const DEFAULT_PALETTE_ID: PaletteId = 'bandal'

export function isPaletteId(value: unknown): value is PaletteId {
  return PALETTES.some((palette) => palette.id === value)
}

export function getPalette(id: PaletteId): PaletteDefinition {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0]!
}

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
 * Order here is the order in the picker: the two everyday modes first, then
 * the context ones. Names describe *brightness and surface* only — the 반달
 * brand and every hue live on the palette axis (`PALETTES`), so a mode name
 * must stay true when a student is on 흑묵 or 이끼.
 */
export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'dark',
    name: '다크',
    description: '가장 어두운 표면. 기본값이며 대부분의 작업에 맞습니다.',
    base: 'dark',
    windowBackground: '#09101e'
  },
  {
    id: 'light',
    name: '라이트',
    description: '밝은 종이 표면. 밝은 강의실과 낮 시간에 맞습니다.',
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
    description: '무채색 표면. UI에서 색을 빼 자료의 색만 남깁니다.',
    base: 'dark',
    windowBackground: '#292929'
  }
] as const

export const DEFAULT_THEME_ID: ThemeId = 'dark'

/** `system` resolves to this pair — the two everyday modes. */
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

/** `system` resolves against the OS; anything else is already a mode id. */
export function resolveThemeId(
  preference: ThemeId | 'system',
  prefersDark: boolean
): ThemeId {
  return preference === 'system'
    ? SYSTEM_THEME[prefersDark ? 'dark' : 'light']
    : preference
}

/**
 * Background color for a BrowserWindow created *before* the renderer can
 * resolve `system`. `prefersDark` comes from `nativeTheme.shouldUseDarkColors`
 * in the main process.
 *
 * The palette wins when it re-tints that mode's surfaces; the three flat modes
 * (`sepia`/`high-contrast`/`graphite`) have no per-palette entry and fall
 * through to the mode's own background.
 */
export function resolveWindowBackground(
  preference: ThemeId | 'system',
  palette: PaletteId,
  prefersDark: boolean
): string {
  const id = resolveThemeId(preference, prefersDark)
  return getPalette(palette).windowBackground[id] ?? getTheme(id).windowBackground
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
  // Palette-independent: a palette never flips a mode's light/dark base.
  return getTheme(resolveThemeId(preference, prefersDark)).base === 'dark'
    ? '#f0ede6'
    : '#1f1a12'
}

/** The resolved (non-`system`) theme actually painted on `<html data-theme>`. */
export type ResolvedTheme = ThemeId
