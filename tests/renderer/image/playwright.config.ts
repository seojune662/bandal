import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'image.e2e.ts',
  outputDir: '/private/tmp/bandal-image-e2e-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  reporter: [['list']]
})
