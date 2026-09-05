import { constants as fsConstants } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { ValidationError } from '../../../src/main/db/errors'
import { createSystemPermissions } from '../../../src/main/features/permissions/systemPermissions'

describe('system permissions', () => {
  test('maps macOS states and checks the data-root parent with a real listing', async () => {
    const denied = Object.assign(new Error('blocked'), { code: 'EACCES' })
    const access = vi.fn(async () => undefined)
    const readdir = vi.fn(async () => {
      throw denied
    })
    const permissions = createSystemPermissions({
      platform: 'darwin',
      getDataRoot: () => '/Users/student/Documents/Bandal',
      getScreenAccess: () => 'restricted',
      requestScreenAccess: async () => [],
      isTrustedAccessibilityClient: () => false,
      notificationIsSupported: () => true,
      openExternal: async () => undefined,
      access,
      readdir,
      now: () => new Date('2026-09-05T01:02:03.000Z')
    })

    await expect(permissions.status()).resolves.toEqual({
      platform: 'darwin',
      permissions: [
        {
          id: 'screen',
          state: 'denied',
          canRequest: false,
          canOpenSettings: true
        },
        {
          id: 'accessibility',
          state: 'denied',
          canRequest: true,
          canOpenSettings: true
        },
        {
          id: 'notifications',
          state: 'unknown',
          canRequest: false,
          canOpenSettings: true
        },
        {
          id: 'documents',
          state: 'denied',
          canRequest: true,
          canOpenSettings: true
        }
      ],
      checkedAt: '2026-09-05T01:02:03.000Z'
    })
    expect(access).toHaveBeenCalledWith(
      '/Users/student/Documents',
      fsConstants.R_OK | fsConstants.W_OK
    )
    expect(readdir).toHaveBeenCalledWith('/Users/student/Documents')
  })

  test('requests screen capture once and returns the refreshed state', async () => {
    let screen: 'not-determined' | 'granted' = 'not-determined'
    const requestScreenAccess = vi.fn(async () => {
      screen = 'granted'
      return []
    })
    const permissions = createSystemPermissions({
      platform: 'darwin',
      getDataRoot: () => '/tmp/Bandal',
      getScreenAccess: () => screen,
      requestScreenAccess,
      isTrustedAccessibilityClient: () => true,
      notificationIsSupported: () => true,
      openExternal: async () => undefined
    })

    await expect(permissions.request('screen')).resolves.toMatchObject({
      id: 'screen',
      state: 'granted',
      canRequest: false
    })
    expect(requestScreenAccess).toHaveBeenCalledOnce()
  })

  test('isolates every failing macOS probe', async () => {
    const permissions = createSystemPermissions({
      platform: 'darwin',
      getDataRoot: () => '/tmp/Bandal',
      getScreenAccess: () => {
        throw new Error('screen probe failed')
      },
      requestScreenAccess: async () => [],
      isTrustedAccessibilityClient: () => {
        throw new Error('accessibility probe failed')
      },
      notificationIsSupported: () => {
        throw new Error('notification probe failed')
      },
      openExternal: async () => undefined,
      access: async () => {
        throw Object.assign(new Error('io'), { code: 'EIO' })
      }
    })

    const report = await permissions.status()
    expect(report.permissions.map(({ state }) => state)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown'
    ])
    expect(report.permissions.map(({ canRequest }) => canRequest)).toEqual([
      false,
      true,
      false,
      true
    ])
  })

  test('rejects platforms without a settings link', async () => {
    const permissions = createSystemPermissions({
      platform: 'linux',
      getDataRoot: () => '/tmp/Bandal',
      getScreenAccess: () => 'unknown',
      requestScreenAccess: async () => [],
      isTrustedAccessibilityClient: () => false,
      notificationIsSupported: () => true,
      openExternal: async () => undefined
    })

    await expect(permissions.openSettings('documents')).rejects.toThrow(
      new ValidationError('이 권한은 시스템 설정 항목이 없어요')
    )
  })

  test('opens each macOS privacy settings deep link', async () => {
    const openExternal = vi.fn(async () => undefined)
    const permissions = createSystemPermissions({
      platform: 'darwin',
      getDataRoot: () => '/tmp/Bandal',
      getScreenAccess: () => 'granted',
      requestScreenAccess: async () => [],
      isTrustedAccessibilityClient: () => true,
      notificationIsSupported: () => true,
      openExternal
    })

    for (const id of [
      'screen',
      'accessibility',
      'notifications',
      'documents'
    ] as const) {
      await permissions.openSettings(id)
    }
    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      'x-apple.systempreferences:com.apple.preference.notifications',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'
    ])
  })
})
