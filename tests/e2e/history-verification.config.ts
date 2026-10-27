import { defineConfig } from '@playwright/test'

const port = Number(process.env.QWERTY_TEST_PORT ?? 4301)
export default defineConfig({
  testDir: '.',
  testMatch: 'history-verification.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { channel: process.env.CI ? undefined : 'chrome', baseURL: 'http://127.0.0.1:' + port, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop' }, { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true } }],
  webServer: {
    command: 'yarn vite --host 127.0.0.1 --port ' + port,
    url: 'http://127.0.0.1:' + port + '/tests/e2e/history-verification.html',
    reuseExistingServer: false,
    timeout: 90_000,
    env: { REACT_APP_DEPLOY_ENV: 'edgeone', VITE_S2_ENABLE_UNIFIED_SYNC: 'true', VITE_QWERTY_SYNC_DISABLED: 'false' },
  },
})
