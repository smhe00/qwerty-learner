import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'etest-three-device-auto-fork.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 390_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'],
    trace: 'off', screenshot: 'off', video: 'off' },
})
