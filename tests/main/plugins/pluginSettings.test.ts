import { expect, test, vi } from 'vitest'
import { createPluginSettings } from '../../../src/main/features/plugins/pluginSettings'
import { sanitizePluginManifest } from '../../../src/shared/plugins/sanitize'

test('configuration persists validated fields, preserves private data and emits only committed values', () => {
  const manifest = sanitizePluginManifest({
    manifestVersion: 2,
    id: 'test.config',
    name: 'Config',
    version: '1.0.0',
    minAppVersion: '0.41.2',
    contributes: {
      settings: [
        {
          key: 'size',
          title: 'Size',
          type: 'number',
          min: 1,
          max: 10,
          default: 2,
        },
      ],
    },
  }).manifest!
  let stored: unknown = { privateData: { openTab: 'one' } }
  const changed = vi.fn()
  const set = vi.fn((_id: string, value: unknown) => {
    stored = value
  })
  const service = createPluginSettings({
    data: { get: () => stored, set, remove: vi.fn() },
    manifest: (id) => (id === manifest.id ? manifest : null),
    changed,
  })
  expect(service.get(manifest.id)).toEqual({ size: 2 })
  service.set(manifest.id, 'size', 6)
  expect(stored).toEqual({ privateData: { openTab: 'one' }, size: 6 })
  expect(() => service.set(manifest.id, 'size', 15)).toThrow()
  expect(() => service.set(manifest.id, '__proto__', {})).toThrow()
  expect(() => service.get('unknown')).toThrow()
  expect(changed).toHaveBeenCalledTimes(1)
  set.mockImplementationOnce(() => {
    throw new Error('disk full')
  })
  expect(() => service.set(manifest.id, 'size', 4)).toThrow('disk full')
  expect(service.get(manifest.id)).toEqual({ size: 6 })
  expect(changed).toHaveBeenCalledTimes(1)
  expect(service.reset(manifest.id)).toEqual({ size: 2 })
  expect(stored).toEqual({ privateData: { openTab: 'one' }, size: 2 })
})
