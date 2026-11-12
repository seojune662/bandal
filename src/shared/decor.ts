/**
 * 꾸미기(decor): the colour the window's glass sits on. A direct translation of
 * the iPad app's `NativeDecorPalette` / `NativeOKLCH` / `NativeDecor`
 * (bandal-iPad App/Native/NativeGlassChrome.swift) so both apps paint the same
 * mesh from the same eight palettes and the same intensity dial.
 *
 * Pure: no DOM. The renderer turns `decorVariables` into CSS custom properties
 * and paints `decorMesh` into the backdrop canvas.
 */

export interface DecorPalette {
  id: DecorPaletteId
  title: string
  titleEn: string
  /** OKLCH hues the mesh runs through, lit top-left corner to bottom-right. */
  hues: readonly [number, number, number]
  /** The mesh's chroma at the dial's tuned point; 0 is grey. */
  chroma: number
}

export const DECOR_PALETTE_IDS = ['dawn', 'blossom', 'sunset', 'forest', 'ocean', 'lavender', 'ink', 'mono'] as const
export type DecorPaletteId = (typeof DECOR_PALETTE_IDS)[number]

export const DECOR_PALETTES: readonly DecorPalette[] = [
  { id: 'dawn', title: '새벽', titleEn: 'Dawn', hues: [270, 295, 345], chroma: 0.05 },
  { id: 'blossom', title: '벚꽃', titleEn: 'Blossom', hues: [350, 15, 50], chroma: 0.05 },
  { id: 'sunset', title: '노을', titleEn: 'Sunset', hues: [30, 60, 330], chroma: 0.06 },
  { id: 'forest', title: '숲', titleEn: 'Forest', hues: [150, 175, 120], chroma: 0.045 },
  { id: 'ocean', title: '바다', titleEn: 'Ocean', hues: [220, 195, 250], chroma: 0.05 },
  { id: 'lavender', title: '라벤더', titleEn: 'Lavender', hues: [300, 280, 320], chroma: 0.045 },
  { id: 'ink', title: '먹', titleEn: 'Ink', hues: [70, 60, 80], chroma: 0.012 },
  { id: 'mono', title: '모노', titleEn: 'Mono', hues: [270, 270, 270], chroma: 0 }
]

export interface DecorSettings {
  palette: DecorPaletteId
  /** 0 is barely there (grey glass over a faint wash), 1 the loudest. */
  intensity: number
}

export const DEFAULT_DECOR: DecorSettings = { palette: 'dawn', intensity: 0.55 }

export function isDecorPaletteId(value: unknown): value is DecorPaletteId {
  return DECOR_PALETTE_IDS.some(id => id === value)
}

export function decorPalette(id: string): DecorPalette {
  return DECOR_PALETTES.find(palette => palette.id === id) ?? DECOR_PALETTES[0]!
}

export function sanitizeDecor(raw: unknown): DecorSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_DECOR }
  const record = raw as Record<string, unknown>
  const intensity = typeof record.intensity === 'number' && Number.isFinite(record.intensity)
    ? Math.min(1, Math.max(0, record.intensity))
    : DEFAULT_DECOR.intensity
  return { palette: isDecorPaletteId(record.palette) ? record.palette : DEFAULT_DECOR.palette, intensity }
}

export type Rgb = readonly [number, number, number]

export type Lab = readonly [number, number, number]

export function oklch(lightness: number, chroma: number, hue: number): Lab {
  const radians = hue * Math.PI / 180
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)]
}

/** OKLab → sRGB 0…1 (Björn Ottosson), clipped into the gamut. */
export function oklabToRgb([lightness, a, b]: Lab): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
  const [r, g, bl] = linear.map(value => {
    const v = Math.min(Math.max(value, 0), 1)
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }) as [number, number, number]
  return [r, g, bl]
}

/** OKLCH → sRGB 0…1, clipped into the gamut (NativeOKLCH.color). */
export function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  return oklabToRgb(oklch(lightness, chroma, hue))
}

export function rgbCss([r, g, b]: Rgb, alpha = 1): string {
  const c = (v: number): number => Math.round(v * 255)
  return alpha >= 1 ? `rgb(${c(r)} ${c(g)} ${c(b)})` : `rgb(${c(r)} ${c(g)} ${c(b)} / ${round(alpha)})`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Hue interpolation the short way round. */
function mixHue(a: number, b: number, t: number): number {
  let delta = (b - a) % 360
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360
  return a + delta * t
}

/** The mesh's chroma follows the dial: a faint wash at 0, the palette as tuned near 0.75, louder past it. */
export function decorSaturation(decor: DecorSettings): number {
  return 0.25 + decor.intensity
}

/**
 * The 3 × 3 mesh, row by row. Lightness falls from the lit corner; hue runs
 * along the diagonal and bows ±12° off it.
 */
export function decorMesh(palette: DecorPalette, dark: boolean, saturation: number): Rgb[] {
  return decorMeshLab(palette, dark, saturation).map(oklabToRgb)
}

/** The same mesh in OKLab, which the backdrop blends in so neighbouring hues never pass through grey. */
export function decorMeshLab(palette: DecorPalette, dark: boolean, saturation: number): Lab[] {
  const colors: Lab[] = []
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const t = (row + column) / 4, bow = (column - row) * 12
      const hue = t < 0.5 ? mixHue(palette.hues[0], palette.hues[1], t * 2) : mixHue(palette.hues[1], palette.hues[2], t * 2 - 1)
      const lightness = dark ? 0.31 - 0.08 * t : 0.955 - 0.045 * t
      colors.push(oklch(lightness, palette.chroma * saturation * (dark ? 1.25 : 1), hue + bow))
    }
  }
  return colors
}

/** Mesh control points (x, y in 0…1), row by row; the middle row and column bow a little. */
export const DECOR_MESH_POINTS: readonly (readonly [number, number])[] = [
  [0, 0], [0.55, 0], [1, 0],
  [0, 0.45], [0.42, 0.56], [1, 0.4],
  [0, 1], [0.6, 1], [1, 1]
]

export function decorAccent(palette: DecorPalette, dark: boolean): Rgb {
  if (palette.chroma === 0) return dark ? [1, 1, 1] : [0, 0, 0]
  return oklchToRgb(dark ? 0.78 : 0.55, dark ? 0.12 : 0.15, palette.hues[0])
}

/** Glass opacity: `quiet` at intensity 0 down to `loud` at 1. Reduce Transparency keeps it solid. */
export function decorAlpha(decor: DecorSettings, quiet: number, loud: number, solid = false): number {
  return solid ? 1 : quiet + (loud - quiet) * decor.intensity
}

const hex = (value: number): Rgb => [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]

/** A neutral surface nudged toward the palette's first hue, by `share` of its chroma. */
function tinted(decor: DecorSettings, dark: boolean, lightness: [number, number], share: number): Rgb {
  const palette = decorPalette(decor.palette)
  return oklchToRgb(dark ? lightness[1] : lightness[0], palette.chroma * share * decorSaturation(decor), palette.hues[0])
}

/**
 * Every decor-driven custom property for one theme. Values are final CSS
 * colors so the stylesheet only has to reference them.
 */
export function decorVariables(decor: DecorSettings, dark: boolean, solid = false): Record<string, string> {
  const palette = decorPalette(decor.palette)
  const accent = decorAccent(palette, dark)
  const selection = dark ? 0.08 + 0.1 * decor.intensity : 0.06 + 0.08 * decor.intensity
  const markChroma = palette.chroma === 0 ? 0 : (dark ? 0.11 : 0.14) * Math.min(1, 0.45 + decor.intensity)
  const mesh = decorMesh(palette, dark, decorSaturation(decor))
  return {
    '--glass-rail': rgbCss(hex(dark ? 0x131315 : 0xdcdce1), decorAlpha(decor, dark ? 0.95 : 0.93, dark ? 0.6 : 0.5, solid)),
    '--glass-panel': rgbCss(hex(dark ? 0x1f1f21 : 0xf4f4f6), decorAlpha(decor, dark ? 0.94 : 0.9, dark ? 0.66 : 0.58, solid)),
    '--glass-selection': rgbCss(accent, selection),
    '--glass-popup': rgbCss(tinted(decor, dark, [0.97, 0.235], 0.55), solid ? 1 : dark ? 0.84 : 0.73),
    '--glass-sheet': rgbCss(tinted(decor, dark, [0.985, 0.235], 0.3), solid ? 1 : 0.93),
    '--decor-accent': rgbCss(accent),
    '--decor-mark-from': palette.chroma === 0 ? 'var(--text-muted)' : rgbCss(oklchToRgb(dark ? 0.8 : 0.62, markChroma, palette.hues[0])),
    '--decor-mark-to': palette.chroma === 0 ? 'var(--text-muted)' : rgbCss(oklchToRgb(dark ? 0.76 : 0.66, markChroma, palette.hues[2])),
    '--decor-base': rgbCss(mesh[4]!),
    '--decor-grain-opacity': String(round(0.08 + 0.16 * decor.intensity))
  }
}

/** Swatch preview: the palette's daylight mesh at full strength (a dark mesh this small reads as mud). */
export function decorSwatchGradient(palette: DecorPalette): string {
  const mesh = decorMesh(palette, false, 2)
  return `linear-gradient(135deg, ${rgbCss(mesh[0]!)}, ${rgbCss(mesh[4]!)} 50%, ${rgbCss(mesh[8]!)})`
}
