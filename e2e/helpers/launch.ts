/**
 * Shared Electron launch helper for the Bandal E2E suite.
 *
 * Every test gets a throwaway profile:
 *  - a temp userData dir (settings.json + bandal.db) via BANDAL_USER_DATA_DIR
 *  - a temp course-data root via BANDAL_DATA_ROOT
 * Both env overrides are honored by src/main (added in M6-B for testability),
 * so tests never touch ~/Library/Application Support/bandal or
 * ~/Documents/Bandal.
 */

import { _electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ONBOARDING_FLOW_VERSION } from '../../src/shared/types/settings'

const PROJECT_ROOT = resolve(__dirname, '..', '..')
const MAIN_ENTRY = join(PROJECT_ROOT, 'out', 'main', 'index.js')

// Resolved at runtime in Node: the 'electron' package exports its binary path.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ELECTRON_BINARY = require('electron') as unknown as string

export interface BandalApp {
  app: ElectronApplication
  page: Page
  /** Temp course-data root (courses create `<dataRoot>/<slug>` here). */
  dataRoot: string
  /** Temp Electron userData dir (settings.json, bandal.db). */
  userDataDir: string
  close: () => Promise<void>
}

/**
 * Launches the built app against a fresh temp profile and waits for the
 * main window to render. Onboarding is pre-marked closed so specs land
 * directly on the shell.
 */
export async function launchBandal(): Promise<BandalApp> {
  const profileDir = mkdtempSync(join(tmpdir(), 'bandal-e2e-'))
  const userDataDir = join(profileDir, 'user-data')
  const dataRoot = join(profileDir, 'Bandal')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(dataRoot, { recursive: true })

  // Seed settings: dark theme, temp data root, onboarding already dismissed.
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify(
      {
        theme: 'dark',
        agentProvider: 'claude-code',
        dataRoot,
        locale: 'ko-KR',
        onboarding: {
          flowVersion: ONBOARDING_FLOW_VERSION,
          closedAt: new Date().toISOString(),
          lastCompletedStep: 3
        }
      },
      null,
      2
    )
  )

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') {
      env[key] = value
    }
  }
  env['BANDAL_USER_DATA_DIR'] = userDataDir
  env['BANDAL_DATA_ROOT'] = dataRoot

  const app = await _electron.launch({
    executablePath: ELECTRON_BINARY,
    args: [MAIN_ENTRY],
    env
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // The shell is up once the course rail exists and the theme is applied.
  await expect(page.locator('aside.app-rail--left')).toBeVisible()
  await expect(page.locator('html[data-theme]')).toBeAttached()

  const close = async (): Promise<void> => {
    await app.close()
    rmSync(profileDir, { recursive: true, force: true })
  }

  return { app, page, dataRoot, userDataDir, close }
}

/** Creates a course through the real UI and waits for it in the sidebar. */
export async function createCourse(page: Page, name: string): Promise<void> {
  const sidebar = page.locator('aside.app-rail--left')
  const emptyStateButton = sidebar
    .locator('.empty-state--courses')
    .getByRole('button', { name: '과목 만들기' })

  if (await emptyStateButton.isVisible()) {
    await emptyStateButton.click()
  } else {
    await sidebar.getByRole('button', { name: '새 과목 만들기' }).click()
  }

  const dialog = page.getByRole('dialog', { name: '새 과목' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('이름').fill(name)
  await dialog.getByRole('button', { name: '과목 만들기' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    sidebar.locator('.course-row__name', { hasText: name })
  ).toBeVisible()
}
