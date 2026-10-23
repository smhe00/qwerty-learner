import { defineConfig, devices } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4193'
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  testDir: '.',
  testMatch: ['mobile-account.spec.ts', 'mobile-account-writer.spec.ts', 'desktop-account.spec.ts', 'desktop-account-password.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'retain-on-failure' },
  webServer: { command: 'yarn dev --host 127.0.0.1 --port ' + port, url: baseURL, reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
})
