/**
 * Theme constants shared with the main process (BrowserWindow background
 * colors must be set before any CSS loads, to avoid a flash). These values
 * MUST mirror `--bg-app` in src/renderer/src/styles/themes/*.css — treat
 * this file as part of the theme layer.
 */

export const WINDOW_BACKGROUND = {
  /** themes/dark-navy.css --bg-app */
  dark: '#0b1220',
  /** themes/light.css --bg-app */
  light: '#faf6ef'
} as const

export type ResolvedTheme = keyof typeof WINDOW_BACKGROUND
