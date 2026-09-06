import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BrowserExtensionPreference } from '../../../src/shared/types/settings'
import { createBrowserExtensionManager } from '../../../src/main/features/browser/extensionManager'

const temporary: string[] = []

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

function extensionFolder(manifest: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'bandal-extension-'))
  temporary.push(root)
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts', 'content.js'), 'document.body.dataset.test = "yes"')
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
  return root
}

function harness() {
  let preferences: BrowserExtensionPreference[] = []
  const loaded = new Map<string, Electron.Extension>()
  const extensions = {
    getAllExtensions: vi.fn(() => [...loaded.values()]),
    loadExtension: vi.fn(async (path: string) => {
      const extension = {
        id: 'extension-id',
        name: 'Reader',
        version: '1.0.0',
        path,
        url: 'chrome-extension://extension-id/',
        manifest: {}
      } as Electron.Extension
      loaded.set(path, extension)
      return extension
    }),
    removeExtension: vi.fn((id: string) => {
      for (const [path, extension] of loaded) {
        if (extension.id === id) loaded.delete(path)
      }
    })
  }
  const manager = createBrowserExtensionManager({
    session: { extensions } as unknown as Electron.Session,
    getPreferences: () => preferences,
    setPreferences: (next) => { preferences = [...next] }
  })
  return { manager, extensions, preferences: () => preferences }
}

describe('browser extension manager', () => {
  test('loads and persists a content-script-only Manifest V3 extension', async () => {
    const path = extensionFolder({
      manifest_version: 3,
      name: 'Reader',
      version: '1.0.0',
      permissions: ['storage'],
      content_scripts: [{ matches: ['https://*/*'], js: ['scripts/content.js'] }]
    })
    const { manager, extensions, preferences } = harness()

    const installed = await manager.install(path)

    expect(installed).toMatchObject({ name: 'Reader', status: 'loaded', enabled: true })
    expect(extensions.loadExtension).toHaveBeenCalledWith(installed.path, { allowFileAccess: false })
    expect(preferences()).toEqual([{ path: installed.path, enabled: true }])
  })

  test('rejects unsupported background service workers instead of pretending they work', async () => {
    const path = extensionFolder({
      manifest_version: 3,
      name: 'Unsupported',
      version: '1.0.0',
      background: { service_worker: 'background.js' }
    })
    const { manager, preferences } = harness()

    await expect(manager.install(path)).rejects.toThrow('background')
    expect(preferences()).toEqual([])
  })

  test('unloads without forgetting when disabled, then can be enabled again', async () => {
    const path = extensionFolder({
      manifest_version: 3,
      name: 'Reader',
      version: '1.0.0',
      content_scripts: [{ matches: ['https://*/*'], js: ['scripts/content.js'] }]
    })
    const { manager, extensions, preferences } = harness()
    const installed = await manager.install(path)

    const disabled = await manager.setEnabled(installed.path, false)

    expect(disabled[0]?.status).toBe('disabled')
    expect(extensions.removeExtension).toHaveBeenCalledWith('extension-id')
    expect(preferences()).toEqual([{ path: installed.path, enabled: false }])
  })
})
