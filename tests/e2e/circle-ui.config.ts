import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.QWERTY_TEST_PORT || 4197)
export default defineConfig({
  testDir: '.', testMatch: ['circle-ui.spec.ts'],
  fullyParallel: false, workers: 1, retries: 0, timeout: 60000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:' + port, trace: 'retain-on-failure' },
  webServer: {
    command: 'yarn dev --host 127.0.0.1 --port ' + port,
    url: 'http://127.0.0.1:' + port + '/tests/e2e/backup-harness.html',
    reuseExistingServer: false, timeout: 120000,
  },
  projects: [{ name: 'chromium' }],
})
