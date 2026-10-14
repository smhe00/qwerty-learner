import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'edgeone-s1-cloud-accounts.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'off', video: 'off' },
})
