import { defineConfig } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4198'
export default defineConfig({
  testDir: '.',
  testMatch: 'secure-entry.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:' + port,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    trace: 'off',
  },
  webServer: {
    command: 'yarn dev --host 127.0.0.1 --port ' + port,
    url: 'http://127.0.0.1:' + port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
