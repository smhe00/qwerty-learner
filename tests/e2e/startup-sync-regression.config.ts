import { defineConfig } from '@playwright/test'

const port = Number(process.env.QWERTY_TEST_PORT ?? 4198)
export default defineConfig({
  testDir: '.',
  testMatch: 'startup-sync-regression.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: { channel: process.env.CI ? undefined : 'chrome', baseURL: 'http://127.0.0.1:' + port, trace: 'retain-on-failure' },
  webServer: {
    command: 'yarn vite --host 127.0.0.1 --port ' + port,
    url: 'http://127.0.0.1:' + port + '/tests/e2e/startup-sync-regression.html',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { REACT_APP_DEPLOY_ENV: 'edgeone', VITE_S2_ENABLE_UNIFIED_SYNC: 'true', VITE_QWERTY_SYNC_DISABLED: 'false' },
  },
})
