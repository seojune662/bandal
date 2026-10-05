import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  CODEX_FALLBACK_MODELS,
  discoverCodexModels,
  parseCodexModelCatalog,
  probeCodexModels
} from '../../../src/main/features/agent/codex/modelCatalog'

const fixture = readFileSync(
  join(process.cwd(), 'tests', 'main', 'agent', 'fixtures', 'codex-models.json'),
  'utf8'
)

describe('Codex model catalog', () => {
  test('parses listed models and labels the configured default', () => {
    expect(parseCodexModelCatalog(fixture, 'gpt-6-astra')).toEqual([
      { value: 'default', displayName: '기본 (gpt-6-astra)' },
      { value: 'gpt-6-astra', displayName: 'GPT-6-Astra' },
      { value: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' }
    ])
  })

  test('falls back to the single default for malformed JSON', () => {
    expect(parseCodexModelCatalog('{not-json')).toEqual(CODEX_FALLBACK_MODELS)
  })

  test('falls back when the model command fails or times out', async () => {
    await expect(probeCodexModels({
      binaryPath: '/bin/codex',
      exec: async () => {
        throw new Error('timed out')
      }
    })).resolves.toEqual(CODEX_FALLBACK_MODELS)
  })
  test('preserves cache provenance without claiming account execution support', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bandal-catalog-'))
    try {
      const cachePath = join(dir, 'models_cache.json')
      writeFileSync(cachePath, JSON.stringify({ ...JSON.parse(fixture), fetched_at: '2026-10-05T15:04:58Z', client_version: '0.159.2' }))
      const result = await discoverCodexModels({ binaryPath: '/bin/codex', configPath: join(dir, 'absent.toml'), cachePath, exec: async () => { throw new Error('older CLI') } })
      expect(result).toMatchObject({ source: 'cache', status: 'unverified', fetchedAt: '2026-10-05T15:04:58Z', cliVersion: '0.159.2', error: expect.stringContaining('거절') })
      expect(result.models.map(model => model.value)).toEqual(['default', 'gpt-6-astra', 'gpt-5.6-sol'])
    } finally { rmSync(dir, { force: true, recursive: true }) }
  })
  test('makes missing explicit models unavailable instead of declaring the default runnable', async () => {
    const result = await discoverCodexModels({ binaryPath: '/bin/codex', cachePath: null, configPath: '/absent/config', exec: async () => ({ stdout: '{broken', stderr: '' }) })
    expect(result).toMatchObject({ models: CODEX_FALLBACK_MODELS, source: 'fallback', status: 'unavailable' })
  })
  test('marks a refreshed CLI list as live while retaining supported effort metadata', async () => {
    const result = await discoverCodexModels({ binaryPath: '/bin/codex', cachePath: null, configPath: '/absent/config', exec: async () => ({ stdout: JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }], default_reasoning_level: 'high' }] }), stderr: '' }) })
    expect(result).toMatchObject({ source: 'live', status: 'ready', models: [expect.any(Object), { value: 'gpt-5.5', displayName: 'GPT-5.5', supportedEfforts: ['high'], defaultEffort: 'high' }] })
  })
})
