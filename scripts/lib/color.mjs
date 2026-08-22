import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Convert an OKLCH color to linear-light sRGB. */
export function oklchToLinearRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

const encode = (channel) =>
  channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055

const decode = (channel) =>
  channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)

/** Parse the OKLCH syntax used by Bandal's CSS tokens. */
export function parseOklch(value) {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i.exec(
    value.trim()
  )
  if (match === null) return null
  return {
    L: Number(match[1]) / 100,
    C: Number(match[2]),
    h: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4])
  }
}

/** -> { rgb: [0..1 gamma-encoded], alpha, inGamut } */
export function parseColor(value) {
  const normalized = value.trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(normalized)
  if (hex !== null) {
    const packed = Number.parseInt(hex[1], 16)
    return {
      rgb: [
        (packed >> 16) & 255,
        (packed >> 8) & 255,
        packed & 255
      ].map((channel) => channel / 255),
      alpha: 1,
      inGamut: true
    }
  }

  const oklch = parseOklch(normalized)
  if (oklch === null) return null
  const linear = oklchToLinearRgb(oklch.L, oklch.C, oklch.h)
  const inGamut = linear.every(
    (channel) => channel >= -0.0005 && channel <= 1.0005
  )
  const rgb = linear.map((channel) =>
    encode(Math.min(1, Math.max(0, channel)))
  )
  return { rgb, alpha: oklch.alpha, inGamut }
}

/** Source-over composite of `fg` (may be translucent) onto opaque `bg`. */
export function composite(fg, bg) {
  return {
    rgb: fg.rgb.map(
      (channel, index) => channel * fg.alpha + bg.rgb[index] * (1 - fg.alpha)
    ),
    alpha: 1,
    inGamut: fg.inGamut && bg.inGamut
  }
}

export function luminance(color) {
  const [r, g, b] = color.rgb.map(decode)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const aLuminance = luminance(a)
  const bLuminance = luminance(b)
  return (
    (Math.max(aLuminance, bLuminance) + 0.05) /
    (Math.min(aLuminance, bLuminance) + 0.05)
  )
}

export function toHex(color) {
  return (
    '#' +
    color.rgb
      .map((channel) =>
        Math.round(Math.min(1, Math.max(0, channel)) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}

/** Turn an opaque OKLCH tuple into the clipped sRGB hex used by image codecs. */
export function oklchToHex({ L, C, h }) {
  const linear = oklchToLinearRgb(
    Math.min(1, Math.max(0, L)),
    Math.max(0, C),
    h
  )
  return toHex({
    rgb: linear.map((channel) =>
      encode(Math.min(1, Math.max(0, channel)))
    ),
    alpha: 1,
    inGamut: linear.every(
      (channel) => channel >= -0.0005 && channel <= 1.0005
    )
  })
}

/** Every `--token: value;` inside one selector's block. */
export function blockTokens(css, selectorRe) {
  const tokens = new Map()
  for (const block of css.matchAll(selectorRe)) {
    for (const match of block[1].matchAll(
      /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
    )) {
      tokens.set(match[1], match[2].trim())
    }
  }
  return tokens
}

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The mode layer: `:root[data-theme='<id>'] { … }`. */
export function readMode(id, modeFiles) {
  const file = modeFiles.get(id)
  if (file === undefined) return null
  const css = readFileSync(file, 'utf8')
  return blockTokens(
    css,
    new RegExp(
      `:root\\[data-theme='${escapeRegExp(id)}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`,
      'g'
    )
  )
}

/** The palette layer for one palette/mode pair. */
export function readPaletteOverride(palette, mode, palettesDir) {
  const file = join(palettesDir, `${palette}.css`)
  const css = readFileSync(file, 'utf8')
  return blockTokens(
    css,
    new RegExp(
      `:root\\[data-palette='${escapeRegExp(palette)}'\\]\\[data-theme='${escapeRegExp(mode)}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`,
      'g'
    )
  )
}

/** What the browser resolves: mode tokens, then the palette overrides. */
export function resolvePair(palette, mode, { modeFiles, palettesDir }) {
  const base = readMode(mode, modeFiles)
  if (base === null) return null
  const merged = new Map(base)
  for (const [name, value] of readPaletteOverride(
    palette,
    mode,
    palettesDir
  )) {
    merged.set(name, value)
  }
  return merged
}

/** Read every palette preview swatch from each file's bare `:root`. */
export function readSwatches(paletteIds, palettesDir) {
  const swatches = new Map()
  for (const palette of paletteIds) {
    const css = readFileSync(join(palettesDir, `${palette}.css`), 'utf8')
    for (const match of css.matchAll(/(--swatch-[a-z-]+)\s*:\s*([^;]+);/gi)) {
      swatches.set(match[1], match[2].trim())
    }
  }
  return swatches
}
