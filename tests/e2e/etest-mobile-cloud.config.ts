import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'etest-mobile-cloud.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  outputDir: '../../.diagnostic/mobile-cloud-results',
  use: { channel: 'chrome', trace: 'off', screenshot: 'off', video: 'off' },
})
