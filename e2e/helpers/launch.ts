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
        },
        // Tour offer (.tour-offer) is a pointer-intercepting dialog — it pops
        // mid-test and steals clicks. Mark the tour as already seen.
        tutorial: { seenVersion: 1, activeCourseId: null }
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

/**
 * Opens an entry of the left rail's "과목 추가" menu. The empty state carries
 * the same two actions inline, so it is used while no course exists yet.
 */
async function chooseAddAction(
  page: Page,
  label: '폴더에서 추가' | '새 과목 만들기'
): Promise<void> {
  const sidebar = page.locator('aside.app-rail--left')
  const emptyState = sidebar.locator('.empty-state--courses')
  if (await emptyState.isVisible()) {
    await emptyState.getByRole('button', { name: label }).click()
    return
  }
  await sidebar.getByRole('button', { name: '과목 추가' }).click()
  await page.getByRole('menu', { name: '과목 추가' }).getByRole('menuitem', { name: label }).click()
}

/** Creates a managed course (folder under the data root) through the real UI. */
export async function createCourse(page: Page, name: string): Promise<void> {
  const sidebar = page.locator('aside.app-rail--left')
  await chooseAddAction(page, '새 과목 만들기')

  const dialog = page.getByRole('dialog', { name: '새 과목' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('이름').fill(name)
  await dialog.getByRole('button', { name: '과목 만들기' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    sidebar.locator('.course-row__name', { hasText: name })
  ).toBeVisible()
}

/**
 * Replaces the native folder picker in the MAIN process so specs can drive
 * `courses:pickFolder` deterministically. `null` simulates a cancel.
 */
export async function stubFolderPicker(
  app: ElectronApplication,
  folderPath: string | null
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(dialog as any).showOpenDialog = async () => ({
      canceled: path === null,
      filePaths: path === null ? [] : [path]
    })
  }, folderPath)
}

/** Registers an existing folder as a course through the real UI. */
export async function addCourseFromFolder(
  app: ElectronApplication,
  page: Page,
  folderPath: string,
  name: string
): Promise<void> {
  const sidebar = page.locator('aside.app-rail--left')
  await stubFolderPicker(app, folderPath)
  await chooseAddAction(page, '폴더에서 추가')

  const dialog = page.getByRole('dialog', { name: '폴더에서 추가' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('이름').fill(name)
  await dialog.getByRole('button', { name: '과목으로 추가' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    sidebar.locator('.course-row__name', { hasText: name })
  ).toBeVisible()
}
