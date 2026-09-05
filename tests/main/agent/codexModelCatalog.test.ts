import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  CODEX_FALLBACK_MODELS,
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
})
