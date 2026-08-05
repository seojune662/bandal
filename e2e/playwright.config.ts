import { defineConfig } from '@playwright/test'

/**
 * Bandal E2E — drives the production build (out/) through Playwright's
 * Electron launcher. Run via `pnpm e2e` (builds first). Electron apps are
 * one-process-per-profile, so everything runs on a single worker.
 */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  workers: 1,
  fullyParallel: false,
  // Local-first suite: fail fast instead of retry-masking flakiness.
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
