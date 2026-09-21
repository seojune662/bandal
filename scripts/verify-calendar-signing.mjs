import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// Inspect the shipped signature, not just the source plist: TCC checks both
// the responsible app and its EventKit child even outside App Sandbox.
const apps = process.argv.slice(2)
if (!apps.length) throw new Error('Usage: node scripts/verify-calendar-signing.mjs <Bandal.app> [...]')
for (const app of apps) {
  for (const target of [app, join(app, 'Contents/Resources/calendar/bandal-calendar')]) {
    const plist = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const entitlements = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' }))
    if (entitlements['com.apple.security.personal-information.calendars'] !== true) {
      throw new Error(`Calendar permission prompt would be blocked: missing calendars entitlement in ${target}`)
    }
    console.log(`Calendar entitlement verified: ${target}`)
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' })
}
