import type { Locator } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BandalApp } from './launch'

/** Product preflight remains active; only external CLI discovery is deterministic. */
export async function installLearningAiFixture(bandal: BandalApp): Promise<void> {
  const fixtureHome = join(bandal.profileDir, 'learning-ai-fixture')
  const appData = join(fixtureHome, 'appdata')
  const fixtureNvm = join(fixtureHome, 'nvm')
  const bin = process.platform === 'win32' ? join(appData, 'npm') : join(fixtureNvm, 'versions', 'node', 'v24.0.0', 'bin')
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(fixtureHome, '.gemini'), { recursive: true })
  writeFileSync(join(bin, process.platform === 'win32' ? 'gemini.cmd' : 'gemini'), process.platform === 'win32' ? '@echo off\r\necho 1.2.3\r\n' : '#!/bin/sh\nprintf \'1.2.3\\n\'\n', { mode: 0o755 })
  writeFileSync(join(fixtureHome, '.gemini', 'oauth_creds.json'), '{}')
  await bandal.app.evaluate(({ ipcMain }, paths) => {
    // Only this disposable Electron process changes its discovery roots.
    process.env['NVM_DIR'] = paths.fixtureNvm
    process.env['APPDATA'] = paths.appData
    process.env['GEMINI_CLI_HOME'] = paths.fixtureHome
    for (const channel of ['agent:availability', 'agent:models']) ipcMain.removeHandler(channel)
    ipcMain.handle('agent:availability', () => ({ installed: true, loggedIn: true, version: 'fixture' }))
    ipcMain.handle('agent:models', () => ({ models: [{ id: 'default', displayName: 'Default', isDefault: true }, { id: 'pro', displayName: 'Fixture model', isDefault: false, supportedEfforts: [] }], source: 'live', status: 'ready' }))
  }, { fixtureHome, appData, fixtureNvm })
}

export async function configureEnglishForm(dialog: Locator, name: string, topic = '우주'): Promise<void> {
  await dialog.getByLabel('학습 공간 이름', { exact: true }).fill(name)
  await dialog.getByLabel(`주제 ${topic}`, { exact: true }).check()
  await dialog.getByLabel('편한 영어 수준', { exact: true }).selectOption('intermediate')
  await dialog.getByLabel('한 편의 읽기 시간', { exact: true }).selectOption('4')
  await chooseLearningAi(dialog)
}
export async function chooseLearningAi(dialog: Locator): Promise<void> {
  await dialog.getByLabel('학습 AI 제공자', { exact: true }).selectOption('gemini')
  await dialog.getByLabel('학습 AI 모델', { exact: true }).selectOption('pro')
}
export const ENGLISH_FIXTURE_SETTINGS = {
  purpose: 'english-reading' as const, topicIds: ['science'], readingSetupConfirmed: true,
  level: 'intermediate' as const, readingMinutes: 4,
  ai: { provider: 'gemini' as const, model: 'pro', effort: null }
}
