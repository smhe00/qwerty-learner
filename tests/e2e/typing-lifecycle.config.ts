import { defineConfig, devices } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4176'
const baseURL = 'http://127.0.0.1:' + port

export default defineConfig({
  testDir: '.',
  testMatch: [ 'typing-lifecycle.spec.ts', 'session-pause.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'yarn dev --host 127.0.0.1 --port ' + port,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
})
