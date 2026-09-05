import { describe, expect, test } from 'vitest'
import { redactSettingsSnapshot } from '../../../src/main/features/diagnostics/diagnosticsBundle'

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
