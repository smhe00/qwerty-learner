import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'learn-block-sync-guarded.spec.ts',
  fullyParallel: false,
  workers: 1, retries: 0, reporter: 'list', timeout: 60_000,
  use: { ...devices['Desktop Chrome'], channel: 'chrome',
    baseURL: 'http://127.0.0.1:4181' },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'yarn vite --host 127.0.0.1 --port 4181',
    url: 'http://127.0.0.1:4181/tests/e2e/backup-harness.html',
    reuseExistingServer: false, timeout: 90000,
  },
})