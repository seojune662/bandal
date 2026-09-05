import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const directory = mkdtempSync(join(tmpdir(), 'bandal-sdk-test-'))
const cli = resolve('out/plugin-cli/plugin.cjs')
const run = (...args) =>
  execFileSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
try {
  const plugin = join(directory, 'study-tool')
  assert.match(
    run('create', plugin, 'test.study-tool'),
    /Created test.study-tool/,
  )
  assert.equal(
    JSON.parse(readFileSync(join(plugin, 'manifest.json'), 'utf8'))
      .manifestVersion,
    2,
  )
  assert.match(run('validate', plugin), /Valid: test.study-tool@1.0.0/)
  assert.throws(() => run('create', plugin), /Destination already exists/)
  const artifact = join(directory, 'plugin.zip')
  const repeated = join(directory, 'repeat.zip')
  assert.match(run('pack', plugin, artifact), /SHA-256 [0-9a-f]{64}/)
  run('pack', plugin, repeated)
  assert.deepEqual(
    readFileSync(artifact),
    readFileSync(repeated),
    'packing must be deterministic',
  )
  assert.throws(() => run('pack', plugin, artifact), /EEXIST/)
  for (const name of [
    'word-count',
    'selection-tools',
    'material-summary',
    'study-theme',
  ]) {
    assert.match(run('validate', resolve('examples/plugins', name)), /Valid:/)
  }
  console.info(
    'SDK: create, validate, deterministic pack, overwrite protection, and four examples passed.',
  )
} finally {
  // This directory was created by this process and contains only SDK fixtures.
  rmSync(directory, { recursive: true, force: true })
}
