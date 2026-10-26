import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.QWERTY_TEST_PORT ?? 4287)
export default defineConfig({
  testDir: '.',
  testMatch: 'learn-save-failure.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `yarn vite --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
