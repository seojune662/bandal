import { describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiagnosticsBundle, redactSettingsSnapshot } from '../../../src/main/features/diagnostics/diagnosticsBundle'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'

describe('diagnostics settings redaction', () => {
  test('removes paths, emails, tokens, and notification ledger values', () => {
    const redacted = redactSettingsSnapshot({
      dataRoot: '/Users/student/private/course-data/Bandal',
      contactEmail: 'student@example.edu',
      apiToken: 'secret-token-value',
      pluginSources: [
        'https://plugins.example.edu/index.json?access_token=private-value'
      ],
      keybindings: { 'app.search': 'Mod+K' },
      university: {
        universityId: 'custom:test',
        displayName: '테스트 대학교',
        maintainer: 'owner@example.edu'
      },
      notifications: {
        sent: {
          'task-1:1': '2026-09-01T00:00:00.000Z',
          'task-2:3': '2026-09-02T00:00:00.000Z'
        }
      }
    })
    const serialized = JSON.stringify(redacted)

    expect(redacted).toMatchObject({
      dataRoot: '~/…/Bandal',
      contactEmail: '[가림]',
      apiToken: '[가림]',
      keybindings: { 'app.search': 'Mod+K' },
      university: {
        universityId: 'custom:test',
        displayName: '테스트 대학교',
        maintainer: '[가림]'
      },
      notifications: { sent: 2 }
    })
    expect(serialized).not.toContain('/Users/student')
    expect(serialized).not.toContain('student@example.edu')
    expect(serialized).not.toContain('owner@example.edu')
    expect(serialized).not.toContain('private-value')
    expect(serialized).not.toContain('secret-token-value')
  })

  test('also masks Windows-style data-root parents', () => {
    expect(
      redactSettingsSnapshot({
        dataRoot: 'C:\\Users\\student@example.edu\\Documents\\Bandal'
      })
    ).toEqual({ dataRoot: '~/…/Bandal' })
  })
})

test('redacts sensitive data in exported app and plugin logs as well as settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bandal-diagnostics-test-'))
  try {
    await writeFile(join(directory, 'app.log'), 'owner@example.test https://login.test/?code=oauth-private&refresh_token=refresh-private\n{"api_key":"key-private"}')
    const writeBundle = createDiagnosticsBundle({ tempDir: () => directory, now: () => new Date('2026-10-07T00:00:00Z'),
      appVersion: () => '1.0.0', electronVersion: () => '1.0.0', platform: 'darwin', osVersion: () => 'test',
      getSettings: () => DEFAULT_SETTINGS, getAgentAvailability: async () => ({ installed: false, loggedIn: false }),
      getPlugins: () => [], getPluginLogs: () => [{ at: '2026-10-07T00:00:00Z', pluginId: 'test', level: 'error', message: 'Bearer bearer-private\n{"api_key":"plugin-key-private"}' }],
      logsPath: () => directory, reveal: () => {} })
    const bundle = await writeBundle()
    const text = await readFile(bundle.path, 'utf8')
    for (const secret of ['owner@example.test', 'oauth-private', 'refresh-private', 'key-private', 'bearer-private', 'plugin-key-private']) expect(text).not.toContain(secret)
    expect(text).toContain('[가림]')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
