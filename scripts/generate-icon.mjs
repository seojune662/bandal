/**
 * Bandal app icon generator.
 *
 * Emits SVG design sources (the truth), renders them to PNG at every macOS
 * iconset size with node-canvas (librsvg-backed, so each size is rasterized
 * from vector — no blurry bitmap downscales), packs `resources/icon.icns` via
 * `iconutil`, packs `resources/icon.ico` for Windows, and writes a 512px
 * `resources/icon.png`.
 *
 * Usage: node scripts/generate-icon.mjs
 *
 * ## The mark
 *
 * 반달 is a half-moon, and 반(半) is "half". The mark says both at once: a
 * complete disc where the lit half is solid gold and the unlit half is only
 * held by a hairline ring — the circle you have finished half of. That is the
 * product's promise (달이 차오르듯, 배움도 조금씩), and it is also what makes
 * the silhouette *not* a generic moon: a stock moon icon is a crescent or a
 * full disc, never a filled half against its own outline.
 *
 * Two deliberate choices keep it from reading as a flat pie/pac-man:
 *   - the terminator bulges ~15% of the radius into the dark side, so it is a
 *     real phase edge rather than a straight chord;
 *   - the whole moon is tilted -14°, the way a half-moon actually hangs.
 *
 * ## Size thresholds (why there is a simplified variant)
 *
 * At 16px the icon is ~16 device pixels wide inside a 13px tile. Craters
 * (34px on the 1024 grid → 0.5px) and stars (5px → 0.08px) do not render as
 * shapes, they render as noise on the gold, which reads as a dirty smudge.
 * So detail is gated by raster size:
 *
 *   | raster    | tier       | moon r | drops                              |
 *   |-----------|------------|--------|------------------------------------|
 *   | ≤ 32px    | `minimal`  | 268    | stars, craters, glow, inner shadow |
 *   | 33–64px   | `medium`   | 252    | stars, craters                     |
 *   | 65–128px  | `detailed` | 240    | stars (they are sub-pixel here)    |
 *   | ≥ 256px   | `full`     | 236    | —                                  |
 *
 * A star is 6px on the 1024 grid: 0.75px at 128, so it renders as a gray
 * speck rather than a star. They only earn their place from 256 up.
 *
 * The mark also grows as the tile shrinks (236 → 268): optical compensation,
 * the standard trick for menu-bar/favicon sizes. The ring thickens and gains
 * opacity for the same reason — a 3px hairline disappears below 32px.
 *
 * Colors track src/renderer/src/styles/themes/dark-navy.css
 * (--bg-app #09101e, --accent ~#f5c97b). The in-app React mark
 * (src/renderer/src/components/BandalMark.tsx) draws the same geometry from
 * theme tokens, so app and icon stay one mark.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createCanvas, loadImage } = require('canvas')
// Transpiled ESM: the callable lives on `.default` under require().
const pngToIco = require('png-to-ico').default

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RESOURCES_DIR = join(ROOT, 'resources')
const ICONSET_DIR = join(ROOT, 'resources', 'bandal.iconset')

// macOS Big Sur icon grid: the visible shape is an 824px rounded square
// centered on a 1024px canvas (100px transparent margin on every side).
const CANVAS = 1024
const INSET = 100
const SHAPE = CANVAS - INSET * 2 // 824
const CORNER_RADIUS = 185

// Moon geometry. cy sits ~1% above geometric center: the glow and the tilt
// weigh the lower-right, so a slight lift reads as optically centered.
const MOON_CX = 512
const MOON_CY = 498
const MOON_TILT = -14
/** Terminator bulge, as a fraction of the radius. 0 = flat chord (dead). */
const TERMINATOR_BULGE = 0.15

/** Detail tiers — see the size-threshold table above.
 * `darkFill` lifts on the small tiers: with no ring to speak of (a 24px
 * stroke is 0.37px at 16), the unfinished half has to carry the disc
 * silhouette on its own value step against the tile. */
const TIERS = {
  minimal: { radius: 268, ring: 24, ringOpacity: 0.55, darkFill: '#202c4d', stars: false, craters: false, glow: false, innerLight: false },
  medium: { radius: 252, ring: 14, ringOpacity: 0.45, darkFill: '#1a2542', stars: false, craters: false, glow: true, innerLight: true },
  detailed: { radius: 240, ring: 8, ringOpacity: 0.36, darkFill: '#16203a', stars: false, craters: true, glow: true, innerLight: true },
  full: { radius: 236, ring: 6, ringOpacity: 0.32, darkFill: '#16203a', stars: true, craters: true, glow: true, innerLight: true }
}

function tierFor(size) {
  if (size <= 32) return TIERS.minimal
  if (size <= 64) return TIERS.medium
  if (size <= 128) return TIERS.detailed
  return TIERS.full
}

/** Deterministic star field (hand-placed — no RNG, stable output). */
const STARS = [
  { x: 318, y: 262, r: 6, o: 0.5 },
  { x: 730, y: 236, r: 4.5, o: 0.4 },
  { x: 232, y: 468, r: 4, o: 0.32 },
  { x: 792, y: 424, r: 3.4, o: 0.28 },
  { x: 264, y: 700, r: 4, o: 0.3 },
  { x: 758, y: 706, r: 5, o: 0.38 }
]

/** Craters on the lit half — {x, y, r} in canvas units, pre-tilt. */
const CRATERS = [
  { x: 592, y: 414, r: 33 },
  { x: 646, y: 542, r: 23 },
  { x: 562, y: 618, r: 17 }
]

function starsSvg() {
  return STARS.map(
    (s) => `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="#dbe4f5" opacity="${s.o}"/>`
  ).join('\n    ')
}

function cratersSvg() {
  return CRATERS.map(
    (c) =>
      `<circle cx="${c.x}" cy="${c.y}" r="${c.r}" fill="#c99a4e" opacity="0.28"/>
      <circle cx="${c.x - c.r * 0.18}" cy="${c.y - c.r * 0.18}" r="${c.r * 0.78}" fill="#e8bd72" opacity="0.3"/>`
  ).join('\n      ')
}

/**
 * The lit half: right semicircle from the top point to the bottom point, then
 * back up along the terminator. The return arc has a small rx, so it bows
 * into the dark side instead of cutting a straight chord.
 */
function litHalfPath(r) {
  const top = `${MOON_CX} ${MOON_CY - r}`
  const bottom = `${MOON_CX} ${MOON_CY + r}`
  const bulge = (r * TERMINATOR_BULGE).toFixed(1)
  return `M ${top} A ${r} ${r} 0 0 1 ${bottom} A ${bulge} ${r} 0 0 1 ${top} Z`
}

/**
 * The icon as SVG. `size` only sets the raster width/height — the viewBox is
 * constant, so librsvg re-rasterizes the vector crisply at every icon size.
 * The detail tier is chosen from `size`.
 */
function iconSvg(size) {
  const tier = tierFor(size)
  const r = tier.radius

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#18223c"/>
      <stop offset="0.55" stop-color="#0d1526"/>
      <stop offset="1" stop-color="#09101e"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.56" cy="0.48" r="0.52">
      <stop offset="0" stop-color="#f5c97b" stop-opacity="0.3"/>
      <stop offset="0.55" stop-color="#f5c97b" stop-opacity="0.09"/>
      <stop offset="1" stop-color="#f5c97b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="moonLit" x1="0.15" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#fbe3ae"/>
      <stop offset="0.5" stop-color="#f5c97b"/>
      <stop offset="1" stop-color="#dda255"/>
    </linearGradient>
    <linearGradient id="innerLight" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.1"/>
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
${tier.stars ? `    ${starsSvg()}` : '    <!-- stars: sub-pixel below 256px -->'}
${tier.glow ? `    <rect x="${INSET}" y="${INSET}" width="${SHAPE}" height="${SHAPE}" fill="url(#glow)"/>` : '    <!-- glow: dropped below 33px -->'}

    <!-- The mark: a whole disc, half of it finished -->
    <g transform="rotate(${MOON_TILT} ${MOON_CX} ${MOON_CY})">
      <!-- unfinished half: barely-there body + the ring that closes the circle -->
      <circle cx="${MOON_CX}" cy="${MOON_CY}" r="${r}" fill="${tier.darkFill}"/>
      <circle cx="${MOON_CX}" cy="${MOON_CY}" r="${r}" fill="none"
              stroke="#f5c97b" stroke-opacity="${tier.ringOpacity}" stroke-width="${tier.ring}"/>

      <!-- finished half -->
      <path d="${litHalfPath(r)}" fill="url(#moonLit)"/>
${tier.craters ? `      ${cratersSvg()}` : '      <!-- craters: dropped below 65px -->'}
    </g>

${tier.innerLight ? `    <rect x="${INSET}" y="${INSET}" width="${SHAPE}" height="${SHAPE}" rx="${CORNER_RADIUS}" fill="url(#innerLight)"/>` : '    <!-- inner shading: dropped below 33px -->'}
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

/**
 * A tray-sized version of the same half-moon geometry, without the app-icon
 * tile or sub-pixel details. macOS template images must be black + alpha so
 * the system can invert them against light and dark menu bars.
 */
function traySvg(size, template) {
  const darkFill = template ? '#000000' : '#16203a'
  const darkOpacity = template ? 0.16 : 1
  const markFill = template ? '#000000' : '#f5c97b'
  const ring = template ? '#000000' : '#f5c97b'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <g transform="rotate(${MOON_TILT} 32 32)">
    <circle cx="32" cy="32" r="25.5" fill="${darkFill}" fill-opacity="${darkOpacity}"/>
    <circle cx="32" cy="32" r="25.5" fill="none" stroke="${ring}" stroke-width="3"/>
    <path d="M 32 6.5 A 25.5 25.5 0 0 1 32 57.5 A 3.8 25.5 0 0 1 32 6.5 Z" fill="${markFill}"/>
  </g>
</svg>
`
}

async function renderTrayPng(size, template, resolution) {
  const image = await loadImage(Buffer.from(traySvg(size, template)))
  const canvas = createCanvas(size, size)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0, size, size)
  return canvas.toBuffer('image/png', { resolution })
}

async function generateTrayIcons() {
  // Electron recognizes the @2x sibling automatically. 72/144 DPI keeps the
  // two files at the scale factors recommended by the Tray documentation.
  writeFileSync(
    join(RESOURCES_DIR, 'trayTemplate.png'),
    await renderTrayPng(16, true, 72)
  )
  writeFileSync(
    join(RESOURCES_DIR, 'trayTemplate@2x.png'),
    await renderTrayPng(32, true, 144)
  )
  writeFileSync(
    join(RESOURCES_DIR, 'tray.ico'),
    await pngToIco([
      await renderTrayPng(16, false, 72),
      await renderTrayPng(32, false, 144)
    ])
  )
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

/** Raster sizes packed into resources/icon.ico (256 is the format ceiling). */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  mkdirSync(RESOURCES_DIR, { recursive: true })
  if (process.argv.includes('--tray-only')) {
    await generateTrayIcons()
    console.log(
      'Generated resources/trayTemplate.png, trayTemplate@2x.png, tray.ico'
    )
    return
  }

  rmSync(ICONSET_DIR, { recursive: true, force: true })
  mkdirSync(ICONSET_DIR, { recursive: true })

  // Design sources of truth: the full mark, and the simplified small variant.
  writeFileSync(join(RESOURCES_DIR, 'icon.svg'), iconSvg(CANVAS))
  writeFileSync(join(RESOURCES_DIR, 'icon-small.svg'), iconSvg(16))

  const rendered = new Map()
  for (const [name, size] of ICONSET_ENTRIES) {
    if (!rendered.has(size)) {
      rendered.set(size, await renderPng(size))
    }
    writeFileSync(join(ICONSET_DIR, name), rendered.get(size))
  }

  // App icon PNG (512) for non-icns consumers.
  writeFileSync(join(RESOURCES_DIR, 'icon.png'), rendered.get(512))

  // Windows .ico. Every size is re-rasterized from the vector rather than
  // downscaled from one big PNG, which is the whole point of the tiered
  // `iconSvg(size)` design — the 16px tile drops craters and thickens the ring.
  // Letting electron-builder auto-convert icon.png would throw that away.
  // 256 is the ICO format's ceiling.
  const icoBuffers = []
  for (const size of ICO_SIZES) {
    if (!rendered.has(size)) {
      rendered.set(size, await renderPng(size))
    }
    icoBuffers.push(rendered.get(size))
  }
  writeFileSync(join(RESOURCES_DIR, 'icon.ico'), await pngToIco(icoBuffers))

  await generateTrayIcons()

  // `iconutil` is macOS-only. On other hosts the .ico and .png are still
  // produced; the committed .icns stays as-is.
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

  console.log(
    `Generated resources/icon.svg, icon-small.svg, icon.png (512px), icon.ico, trayTemplate.png, trayTemplate@2x.png, tray.ico${
      madeIcns ? ', icon.icns' : ' (icon.icns skipped: needs macOS iconutil)'
    }`
  )
}

main().catch((error) => {
  console.error('[generate-icon] failed:', error)
  process.exitCode = 1
})
