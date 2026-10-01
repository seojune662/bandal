/** Audit actual neutral theme colors, including unchanged content colors. */
import { readFileSync } from 'node:fs'
import { composite, contrast, parseColor } from './lib/color.mjs'
let failures = 0
for (const mode of ['light', 'dark']) {
  const css = readFileSync(new URL(`../src/renderer/src/styles/themes/${mode}.css`, import.meta.url), 'utf8')
  const tokens = new Map([...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, parseColor(value)]))
  const white = parseColor('#ffffff')
  const black = parseColor('#000000')
  const check = (label, foreground, background, minimum) => {
    const ratio = foreground && background ? contrast(foreground.alpha < 1 ? composite(foreground, background) : foreground, background) : NaN
    if (!(ratio >= minimum)) { console.error(`${mode}: ${label}: ${ratio.toFixed(2)} < ${minimum}`); failures++ }
  }
  for (const text of ['text-primary', 'text-secondary', 'text-muted']) {
    for (const bg of ['bg-app', 'bg-surface', 'bg-raised']) check(`${text}/${bg}`, tokens.get(text), tokens.get(bg), 4.5)
  }
  check('primary button', tokens.get('on-accent'), tokens.get('accent'), 4.5)
  check('danger button', tokens.get('on-danger'), tokens.get('danger'), 4.5)
  for (const [name, color] of tokens) {
    if (name.startsWith('course-') || name.startsWith('status-')) check(name, color, tokens.get('bg-app'), 3)
    if (name.startsWith('highlight-')) {
      check(`${name} text`, black, color, 4.5)
      check(`${name} on paper`, color, white, 1.25)
    }
  }
  console.log(`${mode}: audited text, controls, course/status colors and PDF highlights`)
}
if (failures) process.exitCode = 1
