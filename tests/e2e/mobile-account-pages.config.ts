import { defineConfig, devices } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4194'
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  testDir: '.',
  testMatch: ['mobile-account-pages.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: 'yarn cross-env REACT_APP_DEPLOY_ENV=pages vite preview --host 127.0.0.1 --port ' + port,
    url: baseURL + '/qwerty-learner/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chrome', use: { channel: 'chrome' } }],
})
