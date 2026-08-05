/**
 * WCAG contrast auditor for Bandal themes — the tool behind STYLEGUIDE §1.2.
 *
 * Parses `src/renderer/src/styles/themes/*.css`, resolves every `oklch()`
 * (compositing alpha tokens over their backdrop), and prints the contrast
 * ratio of every pair the styleguide has a rule about, plus:
 *   - sRGB gamut clipping (a declared color the display cannot show)
 *   - registry drift (`windowBackground` vs the theme's real `--bg-app`)
 *
 * No dependencies: the oklch → sRGB transform is inline.
 * Exit code is non-zero when anything fails, so it can gate CI later.
 *
 * Usage: node scripts/check-contrast.mjs [themeFile ...]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const THEMES_DIR = join(ROOT, 'src/renderer/src/styles/themes')

/* ---------- color math ---------- */

function oklchToLinearRgb(L, C, hDeg) {
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

const encode = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
const decode = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

/** -> { rgb: [0..1 gamma-encoded], alpha, gamut: boolean } */
function parseColor(value) {
  const v = value.trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(v)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return {
      rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255),
      alpha: 1,
      inGamut: true
    }
  }
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(v)
  if (!m) return null
  const lin = oklchToLinearRgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]))
  const inGamut = lin.every((c) => c >= -0.0005 && c <= 1.0005)
  const rgb = lin.map((c) => encode(Math.min(1, Math.max(0, c))))
  return { rgb, alpha: m[4] === undefined ? 1 : Number(m[4]), inGamut }
}

/** Source-over composite of `fg` (may be translucent) onto opaque `bg`. */
function composite(fg, bg) {
  return {
    rgb: fg.rgb.map((c, i) => c * fg.alpha + bg.rgb[i] * (1 - fg.alpha)),
    alpha: 1,
    inGamut: fg.inGamut && bg.inGamut
  }
}

function luminance(color) {
  const [r, g, b] = color.rgb.map(decode)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function toHex(color) {
  return (
    '#' +
    color.rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
      .join('')
  )
}

/* ---------- theme parsing ---------- */

function parseTheme(file) {
  const css = readFileSync(file, 'utf8')
  const tokens = new Map()
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    tokens.set(m[1], m[2].trim())
  }
  return tokens
}

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

function report(file) {
  const tokens = parseTheme(file)
  const name = basename(file, '.css')
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

function checkRegistry(themeFiles) {
  const src = readFileSync(join(ROOT, 'src/shared/theme.ts'), 'utf8')
  const entries = [...src.matchAll(/id:\s*'([a-z-]+)'[\s\S]*?windowBackground:\s*'(#[0-9a-f]{6})'/g)]
  console.log('\n=== registry <-> css sync ===')
  let bad = 0
  const byId = new Map()
  for (const f of themeFiles) {
    const tokens = parseTheme(f)
    for (const [k] of tokens) {
      const m = /^--preview-([a-z-]+)-bg$/.exec(k)
      if (m) byId.set(m[1], { file: f, tokens })
    }
  }
  for (const [, id, bg] of entries) {
    const entry = byId.get(id)
    if (!entry) { console.log(`FAIL ${id}: no themes/*.css defines --preview-${id}-bg`); bad++; continue }
    const appHex = toHex(color(entry.tokens, '--bg-app'))
    const ok = appHex.toLowerCase() === bg.toLowerCase()
    if (!ok) bad++
    console.log(`${ok ? '  ok ' : 'FAIL '}${id}: windowBackground ${bg} vs --bg-app ${appHex}`)
    // Preview swatches must equal the tokens they advertise, or the picker
    // shows a palette the theme does not actually have.
    const MIRRORS = [
      ['bg', '--bg-app'],
      ['surface', '--bg-surface'],
      ['text', '--text-primary'],
      ['accent', '--accent']
    ]
    for (const [key, token] of MIRRORS) {
      const preview = entry.tokens.get(`--preview-${id}-${key}`)
      if (preview === undefined) {
        console.log(`FAIL ${id}: missing --preview-${id}-${key}`)
        bad++
        continue
      }
      const actual = entry.tokens.get(token)
      if (preview !== actual) {
        console.log(`FAIL ${id}: --preview-${id}-${key} is ${preview}, ${token} is ${actual}`)
        bad++
      }
    }
  }
  if (entries.length !== byId.size) { console.log(`FAIL registry has ${entries.length} entries, css has ${byId.size} themes`); bad++ }
  return bad
}

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(THEMES_DIR)
        .filter((f) => f.endsWith('.css') && f !== 'index.css')
        .map((f) => join(THEMES_DIR, f))

let total = 0
for (const f of files) total += report(f)
total += checkRegistry(files)
console.log(`\nTOTAL FAILING: ${total}`)
if (total > 0) process.exitCode = 1
