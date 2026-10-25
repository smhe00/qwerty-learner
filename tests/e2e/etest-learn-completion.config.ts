import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'etest-learn-completion.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 360_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'off', video: 'off' },
})
