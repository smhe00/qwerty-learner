import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: 'login-boot-live-diagnostic.spec.ts', workers: 1, retries: 0,
  timeout: 1_000_000, reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', trace: 'off', screenshot: 'off', video: 'off' }
})
