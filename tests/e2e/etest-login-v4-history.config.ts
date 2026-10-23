import { defineConfig, devices } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: 'etest-login-v4-history.spec.ts',
  workers: 1, retries: 0, timeout: 600_000, reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'off', video: 'off' } })
