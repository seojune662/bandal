/**
 * Bandal app icon generator.
 *
 * Emits a 1024×1024 SVG (the design source of truth), renders it to PNG at
 * every macOS iconset size with node-canvas (librsvg-backed, so each size is
 * rasterized from vector — no blurry bitmap downscales), then packs
 * `resources/icon.icns` via `iconutil` and writes a 512px `resources/icon.png`.
 *
 * Design: 반달 (half-moon) identity — deep navy rounded square (macOS Big Sur
 * grid: 824px shape on the 1024 canvas), a warm moon-gold first-quarter moon
 * with a faint shadowed half and subtle craters, small stars, soft glow.
 * Colors track src/renderer/src/styles/themes/dark-navy.css (--bg-app ~#0b1220,
 * --accent ~#f5c97b).
 *
 * Usage: node scripts/generate-icon.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createCanvas, loadImage } = require('canvas')

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RESOURCES_DIR = join(ROOT, 'resources')
const ICONSET_DIR = join(ROOT, 'resources', 'bandal.iconset')

// macOS Big Sur icon grid: the visible shape is an 824px rounded square
// centered on a 1024px canvas (100px transparent margin on every side).
const CANVAS = 1024
const INSET = 100
const SHAPE = CANVAS - INSET * 2 // 824
const CORNER_RADIUS = 185

// Moon geometry. cy sits ~0.4% above geometric center: the glow and craters
// weigh the lower-right, so a slight lift reads as optically centered.
const MOON_CX = 512
const MOON_CY = 502
const MOON_R = 236

/** Deterministic star field (hand-placed — no RNG, stable output). */
const STARS = [
  { x: 320, y: 268, r: 5, o: 0.5 },
  { x: 726, y: 240, r: 4, o: 0.42 },
  { x: 236, y: 470, r: 3.4, o: 0.34 },
  { x: 788, y: 420, r: 3, o: 0.3 },
  { x: 268, y: 690, r: 3.6, o: 0.3 },
  { x: 762, y: 700, r: 4.4, o: 0.38 },
  { x: 430, y: 218, r: 3, o: 0.32 },
  { x: 636, y: 780, r: 3, o: 0.26 }
]

/** Craters on the lit (right) half — {cx, cy, r} in canvas units. */
const CRATERS = [
  { x: 596, y: 420, r: 34 },
  { x: 648, y: 546, r: 24 },
  { x: 566, y: 620, r: 18 },
  { x: 680, y: 380, r: 14 }
]

function starsSvg() {
  return STARS.map(
    (s) =>
      `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="#dbe4f5" opacity="${s.o}"/>`
  ).join('\n    ')
}

function cratersSvg() {
  return CRATERS.map(
    (c) =>
      `<circle cx="${c.x}" cy="${c.y}" r="${c.r}" fill="#c99a4e" opacity="0.3"/>
    <circle cx="${c.x - c.r * 0.18}" cy="${c.y - c.r * 0.18}" r="${c.r * 0.78}" fill="#e5b76a" opacity="0.35"/>`
  ).join('\n    ')
}

/**
 * The icon as SVG. `size` only sets the raster width/height — the viewBox is
 * constant, so librsvg re-rasterizes the vector crisply at every icon size.
 */
function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#18223c"/>
      <stop offset="0.55" stop-color="#0e1628"/>
      <stop offset="1" stop-color="#0b1220"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.56" cy="0.49" r="0.52">
      <stop offset="0" stop-color="#f5c97b" stop-opacity="0.32"/>
      <stop offset="0.55" stop-color="#f5c97b" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#f5c97b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="moonLit" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#fadfa8"/>
      <stop offset="0.5" stop-color="#f5c97b"/>
      <stop offset="1" stop-color="#e0a95c"/>
    </linearGradient>
    <linearGradient id="innerLight" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="0.18" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.82" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>
    <clipPath id="shape">
      <rect x="${INSET}" y="${INSET}" width="${SHAPE}" height="${SHAPE}" rx="${CORNER_RADIUS}"/>
    </clipPath>
  </defs>

  <g clip-path="url(#shape)">
    <rect x="${INSET}" y="${INSET}" width="${SHAPE}" height="${SHAPE}" fill="url(#bg)"/>
    ${starsSvg()}

    <!-- Moon glow -->
    <rect x="${INSET}" y="${INSET}" width="${SHAPE}" height="${SHAPE}" fill="url(#glow)"/>

    <!-- Shadowed (left) half: barely lighter than the sky -->
    <circle cx="${MOON_CX}" cy="${MOON_CY}" r="${MOON_R}" fill="#1a2540"/>
    <circle cx="${MOON_CX}" cy="${MOON_CY}" r="${MOON_R}" fill="none" stroke="#f5c97b" stroke-opacity="0.14" stroke-width="3"/>

    <!-- Lit (right) half — 반달, first-quarter moon -->
    <path d="M ${MOON_CX} ${MOON_CY - MOON_R}
             A ${MOON_R} ${MOON_R} 0 0 1 ${MOON_CX} ${MOON_CY + MOON_R}
             Z" fill="url(#moonLit)"/>
    ${cratersSvg()}

    <!-- Soft terminator edge -->
    <line x1="${MOON_CX}" y1="${MOON_CY - MOON_R}" x2="${MOON_CX}" y2="${MOON_CY + MOON_R}" stroke="#0b1220" stroke-opacity="0.18" stroke-width="4"/>

    <!-- Inner shadow / top light on the tile -->
    <rect x="${INSET}" y="${INSET}" width="${SHAPE}" height="${SHAPE}" rx="${CORNER_RADIUS}" fill="url(#innerLight)"/>
  </g>

  <!-- Hairline edge so the tile reads on pure-black backgrounds -->
  <rect x="${INSET + 1.5}" y="${INSET + 1.5}" width="${SHAPE - 3}" height="${SHAPE - 3}" rx="${CORNER_RADIUS - 1.5}" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="3"/>
</svg>
`
}

async function renderPng(size) {
  const image = await loadImage(Buffer.from(iconSvg(size)))
  const canvas = createCanvas(size, size)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, size, size)
  return canvas.toBuffer('image/png')
}

/** {file name in the .iconset} → raster size. */
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

async function main() {
  mkdirSync(RESOURCES_DIR, { recursive: true })
  rmSync(ICONSET_DIR, { recursive: true, force: true })
  mkdirSync(ICONSET_DIR, { recursive: true })

  // Design source of truth.
  writeFileSync(join(RESOURCES_DIR, 'icon.svg'), iconSvg(CANVAS))

  const rendered = new Map()
  for (const [name, size] of ICONSET_ENTRIES) {
    if (!rendered.has(size)) {
      rendered.set(size, await renderPng(size))
    }
    writeFileSync(join(ICONSET_DIR, name), rendered.get(size))
  }

  // App icon PNG (512) for non-icns consumers.
  writeFileSync(join(RESOURCES_DIR, 'icon.png'), rendered.get(512))

  execFileSync('iconutil', [
    '-c',
    'icns',
    ICONSET_DIR,
    '-o',
    join(RESOURCES_DIR, 'icon.icns')
  ])
  rmSync(ICONSET_DIR, { recursive: true, force: true })

  console.log('Generated resources/icon.svg, resources/icon.png (512px), resources/icon.icns')
}

main().catch((error) => {
  console.error('[generate-icon] failed:', error)
  process.exitCode = 1
})
