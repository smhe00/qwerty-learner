import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'pages-smoke.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4175/qwerty-learner/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'yarn vite preview --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175/qwerty-learner/',
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
