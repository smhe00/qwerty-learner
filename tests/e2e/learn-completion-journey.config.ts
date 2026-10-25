import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.QWERTY_TEST_PORT ?? 4193)
export default defineConfig({
  testDir: '.',
  testMatch: ['learn-completion-journey.spec.ts', 'learn-block-sync-guarded.spec.ts', 'learn-block-sync-ui.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `yarn vite --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/tests/e2e/backup-harness.html`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
