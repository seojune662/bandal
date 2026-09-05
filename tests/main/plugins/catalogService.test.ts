import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createCatalogService } from '../../../src/main/features/plugins/catalog/catalogService'

const OFFICIAL = 'https://bandal.io/plugins/index.json'
const CUSTOM = 'https://catalog.example/index.json'

function validIndex(): string {
  return JSON.stringify({
    format: 'bandal-plugin-catalog',
    version: 1,
    name: '공식',
    entries: [
      {
        id: 'bandal.example',
        kind: 'extension',
        name: '예제',
        publisher: 'bandal',
        description: '',
        tags: [],
        version: '1.0.0',
        minAppVersion: '0.36.0',
        url: 'example.zip',
        sha256: 'a'.repeat(64)
      }
    ]
  })
}

describe('createCatalogService', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test('isolates a failed source and reuses the disk cache without fetching', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bandal-catalog-service-'))
    roots.push(root)
    const fetch = vi.fn(async (url: string) => {
      if (url === CUSTOM) throw new Error('offline')
      return new Response(validIndex())
    })
    const service = createCatalogService({
      userDataDir: root,
      getPluginSources: () => [CUSTOM],
      fetch,
      now: () => new Date('2026-09-05T00:00:00.000Z')
    })

    const fetched = await service.get(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetched.sources).toEqual([
      expect.objectContaining({ url: OFFICIAL, status: 'ok', entryCount: 1 }),
      expect.objectContaining({ url: CUSTOM, status: 'error', error: 'offline' })
    ])
    expect(fetched.entries[0]?.verified).toBe(true)

    const cacheText = readFileSync(join(root, 'plugin-catalog.json'), 'utf8')
    expect(cacheText).toContain('bandal.example')
    const cached = await createCatalogService({
      userDataDir: root,
      getPluginSources: () => [],
      fetch: async () => {
        throw new Error('must not fetch')
      }
    }).get(false)
    expect(cached).toEqual(fetched)
  })

  test('only the configured marketplace can receive the reviewed badge, including local development', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bandal-catalog-service-'))
    roots.push(root)
    const origin = 'http://127.0.0.1:4318'
    const releaseId = '00000000-0000-0000-0000-000000000001'
    const raw = JSON.parse(validIndex())
    raw.entries[0].url = `${origin}/releases/${releaseId}/download`
    raw.entries[0].marketplaceReleaseId = releaseId
    const service = createCatalogService({ userDataDir: root, getMarketplaceUrl: () => origin,
      getPluginSources: () => [`${origin}/index.json`, CUSTOM], fetch: async () => new Response(JSON.stringify(raw)) })
    const catalog = await service.get(true)
    expect(catalog.entries).toHaveLength(1)
    expect(catalog.entries[0]).toMatchObject({ verified: false, marketplaceReleaseId: releaseId, sourceUrl: `${origin}/index.json` })
  })
})
