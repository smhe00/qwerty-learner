import { defineConfig, devices } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: 'etest-account-progress.spec.ts', workers: 1,
  retries: 0, timeout: 300_000, reporter: 'list',
  use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'off', video: 'off' } })
