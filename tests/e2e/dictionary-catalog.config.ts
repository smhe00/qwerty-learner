import { defineConfig, devices } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4187'
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  testDir: '.',
  testMatch: ['dictionary.spec.ts', 'learn-shell-ui.spec.ts', 'navigation-dialogs.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'yarn dev --host 127.0.0.1 --port ' + port, url: baseURL, reuseExistingServer: false, timeout: 120_000 },
})
