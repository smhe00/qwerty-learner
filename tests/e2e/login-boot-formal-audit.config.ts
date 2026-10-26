import { defineConfig } from '@playwright/test'

const port = Number(process.env.QWERTY_TEST_PORT ?? 4198)
export default defineConfig({
  testDir: '.',
  testMatch: 'login-boot-formal-audit.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: { channel: 'chrome', baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  webServer: {
    command: `yarn vite --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/tests/e2e/login-boot-formal-audit.html`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
})
