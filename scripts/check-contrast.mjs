/**
 * WCAG contrast auditor for Bandal themes — the tool behind STYLEGUIDE §1.2.
 *
 * Appearance is two axes (src/shared/theme.ts): a *mode* in
 * `styles/themes/<id>.css` and a *palette* in `styles/palettes/<id>.css` that
 * overrides a subset of its tokens. What a student actually sees is the
 * cascade of the two, so this tool audits every (palette, mode) **pair** —
 * resolving each one the way the browser would — rather than each file alone.
 *
 * It resolves every `oklch()` (compositing alpha tokens over their backdrop)
 * and prints the contrast ratio of every pair the styleguide has a rule about,
 * plus:
 *   - sRGB gamut clipping (a declared color the display cannot show)
 *   - registry drift (`windowBackground` vs the pair's real `--bg-app`)
 *   - swatch drift (`--swatch-<palette>-<mode>-*` vs the tokens it advertises)
 *
 * No dependencies: the oklch → sRGB transform is inline.
 * Exit code is non-zero when anything fails, so it can gate CI later.
 *
 * Usage: node scripts/check-contrast.mjs [palette:mode ...]
 *   e.g. node scripts/check-contrast.mjs ink:dark moss:sepia
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  composite,
  contrast,
  parseColor,
  readSwatches,
  resolvePair,
  toHex
} from './lib/color.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const THEMES_DIR = join(ROOT, 'src/renderer/src/styles/themes')
const PALETTES_DIR = join(ROOT, 'src/renderer/src/styles/palettes')

/* ---------- registries ---------- */

const THEME_SRC = readFileSync(join(ROOT, 'src/shared/theme.ts'), 'utf8')

/** Slice one `export const <NAME>: readonly … = [ … ] as const` literal. */
function registrySlice(name) {
  const start = THEME_SRC.indexOf(`export const ${name}:`)
  if (start < 0) throw new Error(`theme.ts has no ${name}`)
  return THEME_SRC.slice(start, THEME_SRC.indexOf('] as const', start))
}

const THEME_REGISTRY = [
  ...registrySlice('THEMES').matchAll(
    /id:\s*'([a-z-]+)'[\s\S]*?windowBackground:\s*'(#[0-9a-f]{6})'/g
  )
].map(([, id, windowBackground]) => ({ id, windowBackground }))

const PALETTE_REGISTRY = [
  ...registrySlice('PALETTES').matchAll(
    /id:\s*'([a-z-]+)'[\s\S]*?windowBackground:\s*\{([^}]*)\}/g
  )
].map(([, id, body]) => ({
  id,
  windowBackground: Object.fromEntries(
    [...body.matchAll(/([a-z-]+):\s*'(#[0-9a-f]{6})'/g)].map((m) => [m[1], m[2]])
  )
}))

const MODE_IDS = THEME_REGISTRY.map((t) => t.id)
const PALETTE_IDS = PALETTE_REGISTRY.map((p) => p.id)

/** mode id -> the themes/*.css file that declares its token block. */
const MODE_FILES = new Map()
for (const f of readdirSync(THEMES_DIR).filter(
  (f) => f.endsWith('.css') && f !== 'index.css'
)) {
  const css = readFileSync(join(THEMES_DIR, f), 'utf8')
  for (const m of css.matchAll(/:root\[data-theme='([a-z-]+)'\]/g)) {
    MODE_FILES.set(m[1], join(THEMES_DIR, f))
  }
}

const COLOR_SOURCE = { modeFiles: MODE_FILES, palettesDir: PALETTES_DIR }

/* ---------- theme + palette parsing ---------- */

const PAPER = parseColor('#ffffff') // PDF page canvas — always paper white

function color(tokens, name, backdropName) {
  const raw = tokens.get(name)
  if (raw === undefined) return null
  const parsed = parseColor(raw)
  if (parsed === null) return null
  if (parsed.alpha === 1) return parsed
  const backdrop =
    backdropName === '#ffffff'
      ? PAPER
      : parseColor(tokens.get(backdropName) ?? '')
  if (backdrop === null) return null
  return composite(parsed, backdrop)
}

/* ---------- checks ---------- */

const TEXT_AA = 4.5
const LARGE_AA = 3.0
const NON_TEXT = 3.0
const AAA = 7.0

function report(palette, mode) {
  const tokens = resolvePair(palette, mode, COLOR_SOURCE)
  const name = `${palette} × ${mode}`
  const rows = []

  const push = (label, fg, bg, min, note = '') => {
    if (fg === null || bg === null) {
      rows.push({ label, ratio: NaN, min, note: 'MISSING TOKEN' })
      return
    }
    rows.push({
      label,
      ratio: contrast(fg, bg),
      min,
      note,
      fgHex: toHex(fg),
      bgHex: toHex(bg)
    })
  }

  const surfaces = ['--bg-app', '--bg-surface', '--bg-raised']
  for (const t of ['--text-primary', '--text-secondary', '--text-muted']) {
    for (const s of surfaces) {
      push(`${t} / ${s}`, color(tokens, t, s), color(tokens, s), TEXT_AA)
    }
  }
  for (const s of ['--bg-app', '--bg-surface']) {
    push(`--accent as text / ${s}`, color(tokens, '--accent', s), color(tokens, s), TEXT_AA)
    push(`--danger as text / ${s}`, color(tokens, '--danger', s), color(tokens, s), TEXT_AA)
  }
  push(
    '--on-accent on --accent (primary button label)',
    color(tokens, '--on-accent', '--accent'),
    color(tokens, '--accent'),
    TEXT_AA
  )
  push(
    '--on-danger on --danger (danger button label)',
    color(tokens, '--on-danger', '--danger'),
    color(tokens, '--danger'),
    TEXT_AA
  )
  push(
    '--accent focus ring / --bg-surface',
    color(tokens, '--accent', '--bg-surface'),
    color(tokens, '--bg-surface'),
    NON_TEXT
  )
  push(
    '--accent-muted surface / --bg-surface',
    color(tokens, '--accent-muted', '--bg-surface'),
    color(tokens, '--bg-surface'),
    1.2,
    'selection fill — visibility only'
  )
  push(
    '--text-primary on --accent-muted',
    color(tokens, '--text-primary', '--bg-surface'),
    color(tokens, '--accent-muted', '--bg-surface'),
    TEXT_AA
  )
  push(
    '--border-strong / --bg-surface',
    color(tokens, '--border-strong', '--bg-surface'),
    color(tokens, '--bg-surface'),
    1.15,
    'info: hairline chrome is quiet by design (§8); only 고대비 targets 3.0'
  )

  for (const c of ['gold', 'green', 'blue', 'pink', 'violet', 'orange']) {
    push(`--course-${c} / --bg-app`, color(tokens, `--course-${c}`, '--bg-app'), color(tokens, '--bg-app'), NON_TEXT)
  }
  for (const s of ['todo', 'progress', 'done']) {
    push(`--status-${s} / --bg-app`, color(tokens, `--status-${s}`, '--bg-app'), color(tokens, '--bg-app'), NON_TEXT)
  }

  // PDF: the page canvas is paper-white in every theme.
  for (const h of ['yellow', 'green', 'pink', 'blue']) {
    const hl = color(tokens, `--highlight-${h}`, '#ffffff')
    push(`PDF black text on --highlight-${h} (over paper)`, parseColor('#000000'), hl, TEXT_AA)
    push(`--highlight-${h} vs paper white (visible mark)`, hl, PAPER, 1.25, 'mark must be seen')
    push(
      `--highlight-${h} swatch / --bg-overlay`,
      hl,
      color(tokens, '--bg-overlay', '--bg-surface'),
      1.15,
      'info: 1.4.11 satisfied by the chip ring (.pdf-popover__swatch border)'
    )
  }

  console.log(`\n=== ${name} ===`)
  let fails = 0
  for (const r of rows) {
    const ok = Number.isFinite(r.ratio) && r.ratio >= r.min
    if (!ok) fails++
    const aaa = Number.isFinite(r.ratio) && r.ratio >= AAA ? ' AAA' : ''
    console.log(
      `${ok ? '  ok ' : 'FAIL '}${r.ratio.toFixed(2).padStart(6)} (min ${r.min})${aaa.padEnd(4)}  ${r.label}${r.note ? '  — ' + r.note : ''}`
    )
  }
  // gamut warnings
  for (const [k, v] of tokens) {
    const p = parseColor(v)
    if (p && !p.inGamut) console.log(`  GAMUT ${k}: ${v} clipped -> ${toHex(p)}`)
  }
  console.log(`  ${fails === 0 ? 'ALL PASS' : fails + ' FAILING'}`)
  return fails
}

/**
 * Two structural contracts that a contrast ratio cannot catch:
 *   1. `windowBackground` (the color the BrowserWindow is painted before any
 *      CSS loads) must equal the pair's resolved `--bg-app`, or launch flashes.
 *   2. The picker's swatch table must mirror the tokens it advertises, or a
 *      card previews a palette the app does not actually have.
 */
function checkRegistry(pairs) {
  console.log('\n=== registry <-> css sync ===')
  const swatches = readSwatches(PALETTE_IDS, PALETTES_DIR)
  const SWATCH_MIRRORS = [
    ['bg', '--bg-app'],
    ['surface', '--bg-surface'],
    ['text', '--text-primary'],
    ['accent', '--accent']
  ]
  let bad = 0

  for (const { palette, mode } of pairs) {
    const tokens = resolvePair(palette, mode, COLOR_SOURCE)
    if (tokens === null || tokens.size === 0) {
      console.log(`FAIL ${palette} × ${mode}: no resolved token block`)
      bad++
      continue
    }

    const declared =
      PALETTE_REGISTRY.find((p) => p.id === palette)?.windowBackground[mode] ??
      THEME_REGISTRY.find((t) => t.id === mode)?.windowBackground
    const appHex = toHex(color(tokens, '--bg-app'))
    if (declared === undefined) {
      console.log(`FAIL ${palette} × ${mode}: no windowBackground in either registry`)
      bad++
    } else {
      const ok = declared.toLowerCase() === appHex.toLowerCase()
      if (!ok) bad++
      console.log(
        `${ok ? '  ok ' : 'FAIL '}${palette} × ${mode}: windowBackground ${declared} vs --bg-app ${appHex}`
      )
    }

    for (const [key, token] of SWATCH_MIRRORS) {
      const name = `--swatch-${palette}-${mode}-${key}`
      const swatch = swatches.get(name)
      if (swatch === undefined) {
        console.log(`FAIL ${palette} × ${mode}: missing ${name}`)
        bad++
        continue
      }
      const actual = tokens.get(token)
      if (swatch !== actual) {
        console.log(`FAIL ${name} is ${swatch}, ${token} is ${actual}`)
        bad++
      }
    }
  }

  // A palette file that overrides a mode nobody registered is dead weight.
  for (const palette of PALETTE_IDS) {
    const css = readFileSync(join(PALETTES_DIR, `${palette}.css`), 'utf8')
    for (const m of css.matchAll(
      /:root\[data-palette='([a-z-]+)'\]\[data-theme='([a-z-]+)'\]/g
    )) {
      if (m[1] !== palette) {
        console.log(`FAIL ${palette}.css declares palette '${m[1]}'`)
        bad++
      }
      if (!MODE_IDS.includes(m[2])) {
        console.log(`FAIL ${palette}.css overrides unregistered mode '${m[2]}'`)
        bad++
      }
    }
  }
  return bad
}

/**
 * Default: every (palette, mode) pair. Args narrow it — `ink:dark`, or a bare
 * `ink` / `dark` for one whole row or column.
 */
function selectPairs(args) {
  const all = PALETTE_IDS.flatMap((palette) =>
    MODE_IDS.map((mode) => ({ palette, mode }))
  )
  if (args.length === 0) return all
  return all.filter(({ palette, mode }) =>
    args.some((arg) => {
      const [a, b] = arg.includes(':') ? arg.split(':') : [arg, arg]
      return (a === palette && b === mode) || arg === palette || arg === mode
    })
  )
}

const pairs = selectPairs(process.argv.slice(2))
if (pairs.length === 0) {
  console.error('no (palette, mode) pair matched. Palettes: ' + PALETTE_IDS.join(', ') + '. Modes: ' + MODE_IDS.join(', '))
  process.exitCode = 1
} else {
  let total = 0
  for (const { palette, mode } of pairs) total += report(palette, mode)
  total += checkRegistry(pairs)
  console.log(`\n${pairs.length} pair(s) audited — TOTAL FAILING: ${total}`)
  if (total > 0) process.exitCode = 1
}
