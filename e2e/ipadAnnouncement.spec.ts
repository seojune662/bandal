import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBandal } from './helpers/launch'

const SHOTS = process.env['BANDAL_ANNOUNCEMENT_SHOTS']

test('iPad announcement shows once for existing users and reopens from help', async () => {
  const first = await launchBandal({ keepProfileOnClose: true, extraSettings: { dismissedAnnouncements: [] } })
  const dialog = first.page.getByRole('dialog', { name: 'iPad에서도 반달' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'App Store에서 보기' })).toBeFocused()
  await expect(dialog.getByText('iPad 카메라로 스캔')).toBeVisible()
  if (SHOTS) await first.page.screenshot({ path: join(SHOTS, 'announcement-dark.png') })
  await dialog.getByRole('button', { name: '다음에' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => JSON.parse(readFileSync(join(first.userDataDir, 'settings.json'), 'utf8')).dismissedAnnouncements).toEqual(['ipad-launch-2026-10'])
  await first.close()

  const second = await launchBandal({ reuseProfileDir: first.profileDir })
  try {
    // Longer than the show delay: a dismissed announcement must stay closed.
    await second.page.waitForTimeout(2_000)
    await expect(second.page.getByRole('dialog', { name: 'iPad에서도 반달' })).toHaveCount(0)
    await second.page.getByRole('button', { name: '도움말', exact: true }).click()
    await second.page.getByRole('menuitem', { name: 'iPad 앱 받기' }).click()
    await expect(second.page.getByRole('dialog', { name: 'iPad에서도 반달' })).toBeVisible()
  } finally {
    await second.close()
  }
})

test('first-run users in onboarding do not get the announcement', async () => {
  const bandal = await launchBandal({ extraSettings: { dismissedAnnouncements: [], onboarding: { flowVersion: 0, closedAt: null, lastCompletedStep: 0 } } })
  try {
    await bandal.page.waitForTimeout(2_000)
    await expect(bandal.page.getByRole('dialog', { name: 'iPad에서도 반달' })).toHaveCount(0)
  } finally {
    await bandal.close()
  }
})

test('light theme renders the announcement', async () => {
  test.skip(!SHOTS, 'screenshot-only check')
  const bandal = await launchBandal({ extraSettings: { theme: 'light', dismissedAnnouncements: [] } })
  try {
    await expect(bandal.page.getByRole('dialog', { name: 'iPad에서도 반달' })).toBeVisible()
    await bandal.page.screenshot({ path: join(SHOTS!, 'announcement-light.png') })
  } finally {
    await bandal.close()
  }
})
