import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join, resolve } from 'node:path'

const unsigned = process.argv.includes('--unsigned')
const targets = process.argv.slice(2).filter(value => value !== '--unsigned')
if (!targets.length) throw new Error('Usage: node scripts/verify-photo-picker.mjs [--unsigned] <Bandal.app|helper> [...]')
for (const input of targets) {
  const target = resolve(input)
  const bundle = target.endsWith('.app')
  const helper = bundle ? join(target, 'Contents/Resources/photo-picker/bandal-photo-picker') : target
  accessSync(helper, constants.R_OK | constants.X_OK)
  const archs = path => execFileSync('lipo', ['-archs', path], { encoding: 'utf8' }).trim().split(/\s+/)
  const architectures = archs(helper)
  if (bundle && !archs(join(target, 'Contents/MacOS/Bandal')).every(arch => architectures.includes(arch))) {
    throw new Error(`Photo picker architecture differs from its app: ${helper}`)
  }
  if (!unsigned) {
    if (!bundle) throw new Error('Signed verification requires the owning app bundle.')
    const teams = [target, helper].map(path => {
      execFileSync('codesign', ['--verify', '--strict', path], { stdio: 'pipe' })
      const signature = spawnSync('codesign', ['-d', '--verbose=4', path], { encoding: 'utf8' })
      if (signature.status !== 0) throw new Error(`Cannot inspect photo picker signature: ${path}`)
      return /TeamIdentifier=(\S+)/.exec(signature.stderr)?.[1]
    })
    if (!teams[0] || teams[0] === 'not' || teams[0] !== teams[1]) throw new Error('Photo picker must be signed by its app team.')
  }
  if (architectures.includes(process.arch === 'x64' ? 'x86_64' : process.arch)) {
    const result = JSON.parse(execFileSync(helper, ['--self-test'], { encoding: 'utf8', timeout: 10_000 }))
    if (result.protocol !== 1 || result.selfTest !== true || result.platform !== 'darwin') throw new Error('Photo picker self-test failed.')
  }
  console.log(`Photo picker architecture, signature and available self-test verified: ${helper}`)
}
