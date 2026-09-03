/**
 * Typography discipline auditor — the weight half of STYLEGUIDE §1.
 *
 * The app once carried 14 ad-hoc font-weights (450…750) that encoded no role:
 * `.course-dialog h2` and `.field-label` were both 650, and chat body prose
 * was 700. Locally each number looked deliberate; together they meant every
 * surface read as emphasized and nothing stood out. tokens.css now exposes
 * exactly three role tokens, and this script is what keeps it at three.
 *
 * Checks:
 *   1. no raw numeric `font-weight` outside tokens.css
 *   2. tokens.css declares exactly the three --weight-* roles
 *   3. `strong` / semantic-bold selectors still resolve to --weight-title
 *      (demoting those silently breaks **bold** in the note editor)
 *
 * Exit code is non-zero when anything fails, so it can gate CI later.
 *
 * Usage: node scripts/check-typography.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync, statSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STYLES = join(ROOT, 'src', 'renderer', 'src')
const TOKENS = join(STYLES, 'styles', 'tokens.css')
const ROLES = ['--weight-body', '--weight-label', '--weight-title']

/** Every .css under the renderer, recursively. */
function cssFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return cssFiles(full)
    return full.endsWith('.css') ? [full] : []
  })
}

const failures = []

// 1. Raw numeric weights. tokens.css is the one file allowed to name numbers.
for (const file of cssFiles(STYLES)) {
  if (file === TOKENS) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = /font-weight:\s*(\d+)/.exec(line)
    if (m !== null) {
      failures.push(
        `${relative(ROOT, file)}:${i + 1}  raw font-weight: ${m[1]} — ` +
          `use var(--weight-body|label|title)`
      )
    }
  })
}

// 2. Exactly three roles, no more.
const tokensSrc = readFileSync(TOKENS, 'utf8')
for (const role of ROLES) {
  if (!new RegExp(String.raw`^\s*` + role + String.raw`:\s*\d+;`, 'm').test(tokensSrc)) {
    failures.push(`tokens.css  missing role token ${role}`)
  }
}
const declared = [...tokensSrc.matchAll(/^\s*(--weight-[a-z-]+):/gm)].map((m) => m[1])
for (const extra of declared.filter((d) => !ROLES.includes(d))) {
  failures.push(`tokens.css  extra weight role ${extra} — the scale is three`)
}

// 3. Every rule whose selector carries a bare `strong` or `.token.important`
//    must resolve to --weight-title. `**md**` in the note editor renders
//    through `.milkdown strong`; if that silently drops to --weight-label,
//    bold text in a student's notes stops looking bold.
const RULE = /([^{}]+)\{([^}]*)\}/g
const SEMANTIC_SEL = /(^|[\s>+~])strong\b|\.token\.important/
for (const file of cssFiles(STYLES)) {
  const src = readFileSync(file, 'utf8')
  for (const [, selector, body] of src.matchAll(RULE)) {
    if (!SEMANTIC_SEL.test(selector)) continue
    if (!/font-weight:/.test(body)) continue
    // `inherit` is an explicit opt-out, not a drift: the address bar
    // recolors its <strong> domain without bolding it.
    if (/font-weight:\s*inherit/.test(body)) continue
    if (!/font-weight:\s*var\(--weight-title\)/.test(body)) {
      failures.push(
        `${relative(ROOT, file)}  semantic bold \`${selector.trim()}\` is not --weight-title`
      )
    }
  }
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} typography violation(s):\n`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log('✓ typography: 3 weight roles, no raw numeric font-weight, semantic bold intact')
