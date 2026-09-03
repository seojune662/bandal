import { describe, expect, test } from 'vitest'
import {
  PLUGIN_API_PERMISSIONS,
  describePermission,
  isMethodAllowed,
  netPermissionHost
} from '../../../src/shared/plugins/permissions'
import { PLUGIN_API_METHODS } from '../../../src/shared/types/pluginRpc'

describe('plugin API permission contract', () => {
  test('maps every public RPC method to one permission', () => {
    expect(Object.keys(PLUGIN_API_PERMISSIONS).sort()).toEqual(
      [...PLUGIN_API_METHODS].sort()
    )
  })

  test('allows static API methods only with their exact grant', () => {
    expect(isMethodAllowed(['courses.read'], 'courses.current')).toBe(true)
    expect(isMethodAllowed(['notes.read'], 'courses.current')).toBe(false)
    expect(isMethodAllowed(['notes.read'], 'notes.read')).toBe(true)
    expect(isMethodAllowed(['notes.read'], 'notes.write')).toBe(false)
    expect(isMethodAllowed(['notes.write'], 'notes.create')).toBe(true)
  })

  test('allows only exact, portless HTTPS hosts for net.fetch', () => {
    const grants = ['net:api.example.com'] as const

    expect(
      isMethodAllowed(grants, 'net.fetch', 'https://api.example.com/v1?q=1')
    ).toBe(true)
    expect(
      isMethodAllowed(grants, 'net.fetch', 'https://API.EXAMPLE.COM/v1')
    ).toBe(true)
    expect(
      isMethodAllowed(grants, 'net.fetch', 'http://api.example.com/v1')
    ).toBe(false)
    expect(
      isMethodAllowed(grants, 'net.fetch', 'https://api.example.com:8443/v1')
    ).toBe(false)
    expect(
      isMethodAllowed(grants, 'net.fetch', 'https://sub.api.example.com/v1')
    ).toBe(false)
    expect(isMethodAllowed(grants, 'net.fetch', 'not a url')).toBe(false)
    expect(isMethodAllowed(grants, 'net.fetch')).toBe(false)
  })

  test('extracts network hosts and describes grants for approval UI', () => {
    expect(netPermissionHost('notes.read')).toBeNull()
    expect(netPermissionHost('net:')).toBeNull()
    expect(netPermissionHost('net:api.example.com')).toBe('api.example.com')
    expect(describePermission('notes.write', 'ko-KR')).toContain('노트')
    expect(describePermission('notes.write', 'en-US')).toContain('notes')
    expect(describePermission('net:api.example.com', 'ko-KR')).toContain(
      'api.example.com'
    )
  })
})
