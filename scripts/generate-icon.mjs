/**
 * Build-time Bandal app icon generator.
 *
 * Usage:
 *   node scripts/generate-icon.mjs
 *   node scripts/generate-icon.mjs --check
 *   node scripts/generate-icon.mjs --tray-only
 *   node scripts/generate-icon.mjs --help
 *
 * The full command writes eight palette/base variants under
 * `resources/icons/`, then refreshes the legacy `resources/icon.*` and tray
 * files from the pixel-compatible `bandal-dark` colors.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { moonSvgPaths, MOON_VIEWBOX } from '../src/shared/brandMark.mjs'
import {
  contrast,
  oklchToHex,
  parseColor,
  parseOklch,
  readSwatches,
  toHex
} from './lib/color.mjs'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RESOURCES_DIR = join(ROOT, 'resources')
const ICONS_DIR = join(RESOURCES_DIR, 'icons')
const MANIFEST_FILE = join(ICONS_DIR, 'manifest.json')
const ICONSET_DIR = join(RESOURCES_DIR, 'bandal.iconset')
const PALETTES_DIR = join(
  ROOT,
  'scripts/icon-palettes'
)

export const ICON_PALETTES = ['bandal', 'ink', 'lavender', 'moss']
export const ICON_BASES = ['dark', 'light']

// macOS Big Sur icon grid: the visible shape is an 824px rounded square
// centered on a 1024px canvas (100px transparent margin on every side).
const CANVAS = 1024
const INSET = 100
const SHAPE = CANVAS - INSET * 2
const CORNER_RADIUS = 185

/**
 * The released icon palette. This exception deliberately does not move with
 * CSS swatches: the legacy bandal-dark outputs must stay pixel-identical.
 */
export const BANDAL_DARK_COLORS = Object.freeze({
  bg: '#161616',
  bgTop: '#161616',
  bgMid: '#161616',
  accent: '#fafafa',
  accentLight: '#fbe3ae',
  accentDark: '#dda255',
  craterDark: '#c99a4e',
  craterLight: '#e8bd72',
  darkFill: Object.freeze(['#202c4d', '#1a2542', '#16203a']),
  star: '#dbe4f5'
})

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value))

function opaqueOklch(value, label) {
  const parsed = parseOklch(value)
  if (parsed === null || parsed.alpha !== 1) {
    throw new TypeError(`${label} must be an opaque oklch() color: ${value}`)
  }
  return parsed
}

function shiftedHex(source, lightness, chroma) {
  return oklchToHex({
    L: clamp(lightness, 0, 1),
    C: Math.max(0, chroma),
    h: source.h
  })
}

/**
 * Derive raster-safe sRGB colors by changing only OKLCH lightness/chroma.
 * Dark bases lift the moon; light bases lower it so the mark remains a dark
 * moon on a bright tile. The center accent is nudged until it clears 3:1.
 */
export function deriveIconColors({ bg, accent, base }) {
  if (!ICON_BASES.includes(base)) {
    throw new TypeError(`icon base must be dark or light: ${base}`)
  }

  const background = opaqueOklch(bg, 'bg')
  const signal = opaqueOklch(accent, 'accent')
  const bgHex = toHex(parseColor(bg))
  const direction = base === 'dark' ? 1 : -1
  let accentL =
    base === 'dark'
      ? Math.max(signal.L, 0.76)
      : Math.min(signal.L, 0.48)

  let accentHex = shiftedHex(signal, accentL, signal.C)
  while (
    contrast(parseColor(bgHex), parseColor(accentHex)) < 3 &&
    accentL > 0.12 &&
    accentL < 0.96
  ) {
    accentL = clamp(accentL + direction * 0.02, 0.12, 0.96)
    accentHex = shiftedHex(signal, accentL, signal.C)
  }

  const darkBase = base === 'dark'
  const darkFill = darkBase
    ? [
        shiftedHex(
          background,
          background.L + 0.12,
          background.C + 0.016
        ),
        shiftedHex(
          background,
          background.L + 0.085,
          background.C + 0.011
        ),
        shiftedHex(
          background,
          background.L + 0.06,
          background.C + 0.008
        )
      ]
    : [
        // On light tiles the unfinished hemisphere is a pale, low-chroma
        // step down from the tile. Keeping it far from the dark accent makes
        // the half-moon legible instead of collapsing into a full dark disc.
        shiftedHex(
          background,
          background.L - 0.16,
          background.C * 0.55
        ),
        shiftedHex(
          background,
          background.L - 0.14,
          background.C * 0.45
        ),
        shiftedHex(
          background,
          background.L - 0.12,
          background.C * 0.35
        )
      ]

  return {
    bg: bgHex,
    bgTop: shiftedHex(
      background,
      background.L + (darkBase ? 0.09 : 0.02),
      background.C + (darkBase ? 0.012 : -background.C * 0.35)
    ),
    bgMid: shiftedHex(
      background,
      background.L + (darkBase ? 0.035 : 0.008),
      background.C + (darkBase ? 0.006 : -background.C * 0.18)
    ),
    accent: accentHex,
    accentLight: shiftedHex(
      signal,
      accentL + (darkBase ? 0.08 : 0.04),
      Math.max(0, signal.C - (darkBase ? 0.015 : 0.01))
    ),
    accentDark: shiftedHex(
      signal,
      accentL - (darkBase ? 0.12 : 0.1),
      signal.C + 0.005
    ),
    craterDark: shiftedHex(
      signal,
      accentL + (darkBase ? -0.16 : 0.12),
      signal.C * (darkBase ? 0.86 : 0.7)
    ),
    craterLight: shiftedHex(
      signal,
      accentL + (darkBase ? -0.04 : 0.22),
      signal.C * (darkBase ? 0.72 : 0.45)
    ),
    darkFill,
    star: shiftedHex(
      background,
      darkBase ? 0.9 : 0.38,
      Math.min(background.C, 0.025)
    )
  }
}

/** Pure palette swatch -> eight icon variants transform. */
export function iconVariantsFromSwatches(swatches) {
  return ICON_PALETTES.flatMap((palette) =>
    ICON_BASES.map((base) => {
      const id = `${palette}-${base}`
      const bg = swatches.get(`--swatch-${palette}-${base}-bg`)
      const accent = swatches.get(`--swatch-${palette}-${base}-accent`)
      if (bg === undefined || accent === undefined) {
        throw new Error(`missing icon swatches for ${id}`)
      }
      const derived = deriveIconColors({ bg, accent, base })
      return {
        id,
        palette,
        base,
        colors: { ...derived, bg: base === 'dark' ? '#161616' : '#fafafa', accent: base === 'dark' ? '#fafafa' : '#161616' }
      }
    })
  )
}

export function readIconVariants() {
  return iconVariantsFromSwatches(
    readSwatches(ICON_PALETTES, PALETTES_DIR)
  )
}

export function hashIconColors(colors) {
  return createHash('sha256').update(JSON.stringify(colors)).digest('hex')
}

export function createIconManifest(variants) {
  return {
    version: 2,
    variants: Object.fromEntries(
      variants.map(({ id, colors }) => [
        id,
        { colorsHash: hashIconColors(colors) }
      ])
    )
  }
}

/** Return current variant ids whose color hash is absent or out of date. */
export function compareIconManifest(expected, actual) {
  const expectedVariants = expected?.variants ?? {}
  if (actual?.version !== expected?.version) {
    return Object.keys(expectedVariants)
  }
  const actualVariants = actual?.variants ?? {}
  return Object.keys(expectedVariants).filter(
    (id) =>
      actualVariants[id]?.colorsHash !== expectedVariants[id]?.colorsHash
  )
}

/** Monochrome brand is independent of the student's workspace theme. */
export function iconSvg(size, colors) {
  const dark = colors.bg === '#161616'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><rect x="100" y="100" width="824" height="824" rx="185" fill="${dark ? '#161616' : '#fafafa'}"/><svg x="148" y="142" width="728" height="728" viewBox="${MOON_VIEWBOX}">${moonSvgPaths(dark ? '#fafafa' : '#161616')}</svg></svg>`
}
export function traySvg(size, template, colors) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MOON_VIEWBOX}">${moonSvgPaths(template ? '#000000' : colors.accent)}</svg>`
}

function canvasApi() {
  return require('canvas')
}

function pngToIcoApi() {
  return require('png-to-ico').default
}

async function renderPng(size, colors) {
  const { createCanvas, loadImage } = canvasApi()
  const image = await loadImage(Buffer.from(iconSvg(size, colors)))
  const canvas = createCanvas(size, size)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, size, size)
  return canvas.toBuffer('image/png')
}

async function renderTrayPng(size, template, resolution, colors) {
  const { createCanvas, loadImage } = canvasApi()
  const image = await loadImage(Buffer.from(traySvg(size, template, colors)))
  const canvas = createCanvas(size, size)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, size, size)
  return canvas.toBuffer('image/png', { resolution })
}

async function renderTrayFiles(colors) {
  const template = await renderTrayPng(16, true, 72, colors)
  const template2x = await renderTrayPng(32, true, 144, colors)
  const trayIco = await pngToIcoApi()([
    await renderTrayPng(16, false, 72, colors),
    await renderTrayPng(32, false, 144, colors)
  ])
  return { template, template2x, trayIco }
}

async function writeVariant({ id, colors }) {
  const outputDir = join(ICONS_DIR, id)
  mkdirSync(outputDir, { recursive: true })
  const [icon512, icon256, tray] = await Promise.all([
    renderPng(512, colors),
    renderPng(256, colors),
    renderTrayFiles(colors)
  ])
  writeFileSync(join(outputDir, 'icon-512.png'), icon512)
  writeFileSync(join(outputDir, 'icon-256.png'), icon256)
  writeFileSync(join(outputDir, 'trayTemplate.png'), tray.template)
  writeFileSync(join(outputDir, 'trayTemplate@2x.png'), tray.template2x)
  writeFileSync(join(outputDir, 'tray.ico'), tray.trayIco)
  return { icon512, icon256, tray }
}

/** {file name in the .iconset} -> raster size. */
const ICONSET_ENTRIES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

/** Raster sizes packed into resources/icon.ico (256 is the format ceiling). */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function writeLegacyFiles(colors, renderedVariant) {
  writeFileSync(join(RESOURCES_DIR, 'icon.svg'), iconSvg(CANVAS, colors))
  writeFileSync(join(RESOURCES_DIR, 'icon-small.svg'), iconSvg(16, colors))
  writeFileSync(join(RESOURCES_DIR, 'icon.png'), renderedVariant.icon512)
  writeFileSync(
    join(RESOURCES_DIR, 'trayTemplate.png'),
    renderedVariant.tray.template
  )
  writeFileSync(
    join(RESOURCES_DIR, 'trayTemplate@2x.png'),
    renderedVariant.tray.template2x
  )
  writeFileSync(join(RESOURCES_DIR, 'tray.ico'), renderedVariant.tray.trayIco)

  rmSync(ICONSET_DIR, { recursive: true, force: true })
  mkdirSync(ICONSET_DIR, { recursive: true })
  const rendered = new Map([
    [256, renderedVariant.icon256],
    [512, renderedVariant.icon512]
  ])
  for (const [name, size] of ICONSET_ENTRIES) {
    if (!rendered.has(size)) rendered.set(size, await renderPng(size, colors))
    writeFileSync(join(ICONSET_DIR, name), rendered.get(size))
  }

  const icoBuffers = []
  for (const size of ICO_SIZES) {
    if (!rendered.has(size)) rendered.set(size, await renderPng(size, colors))
    icoBuffers.push(rendered.get(size))
  }
  writeFileSync(join(RESOURCES_DIR, 'icon.ico'), await pngToIcoApi()(icoBuffers))

  let madeIcns = false
  if (process.platform === 'darwin') {
    execFileSync('iconutil', [
      '-c',
      'icns',
      ICONSET_DIR,
      '-o',
      join(RESOURCES_DIR, 'icon.icns')
    ])
    madeIcns = true
  }
  rmSync(ICONSET_DIR, { recursive: true, force: true })
  return madeIcns
}

function printHelp() {
  console.log(`Usage: node scripts/generate-icon.mjs [option]

Options:
  --check       Verify resources/icons/manifest.json against palette swatches
  --tray-only   Refresh only the legacy bandal-dark tray files
  --help, -h    Show this help without loading native canvas

Without an option, generates 8 palette/base variants plus legacy resources.`)
}

function checkManifest() {
  const expected = createIconManifest(readIconVariants())
  let actual = null
  try {
    actual = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const stale = compareIconManifest(expected, actual)
  if (stale.length > 0) {
    console.error(
      `[generate-icon] stale icon variants: ${stale.join(', ')}`
    )
    process.exitCode = 1
    return
  }
  console.log('Icon manifest is current (8 variants).')
}

async function generateLegacyTrayOnly() {
  mkdirSync(RESOURCES_DIR, { recursive: true })
  const tray = await renderTrayFiles(BANDAL_DARK_COLORS)
  writeFileSync(join(RESOURCES_DIR, 'trayTemplate.png'), tray.template)
  writeFileSync(join(RESOURCES_DIR, 'trayTemplate@2x.png'), tray.template2x)
  writeFileSync(join(RESOURCES_DIR, 'tray.ico'), tray.trayIco)
  console.log(
    'Generated resources/trayTemplate.png, trayTemplate@2x.png, tray.ico'
  )
}

async function generateAll() {
  mkdirSync(ICONS_DIR, { recursive: true })
  const variants = readIconVariants()
  let bandalDarkRendered = null
  for (const variant of variants) {
    const rendered = await writeVariant(variant)
    if (variant.id === 'bandal-dark') bandalDarkRendered = rendered
  }
  if (bandalDarkRendered === null) {
    throw new Error('bandal-dark variant was not generated')
  }

  const madeIcns = await writeLegacyFiles(
    BANDAL_DARK_COLORS,
    bandalDarkRendered
  )
  writeFileSync(
    MANIFEST_FILE,
    `${JSON.stringify(createIconManifest(variants), null, 2)}\n`
  )
  console.log(
    `Generated 8 variants in resources/icons, legacy icon/tray resources${
      madeIcns ? ', and resources/icon.icns' : ' (icon.icns needs macOS)'
    }`
  )
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return
  }
  if (args.includes('--check')) {
    checkManifest()
    return
  }
  if (args.includes('--tray-only')) {
    await generateLegacyTrayOnly()
    return
  }
  await generateAll()
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch((error) => {
    console.error('[generate-icon] failed:', error)
    process.exitCode = 1
  })
}
