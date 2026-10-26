import { defineConfig } from '@playwright/test'
const port = process.env.QWERTY_TEST_PORT || '4187'
export default defineConfig({
  testDir: '.', testMatch: 'feedback.spec.ts', workers: 1, retries: 0, timeout: 90000,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:' + port, channel: process.env.CI ? undefined : 'chrome', trace: 'retain-on-failure' },
  webServer: { cwd: process.cwd(), command: 'node node_modules/vite/bin/vite.js --config tests/e2e/feedback.vite.config.ts --host 127.0.0.1 --port ' + port,
    url: 'http://127.0.0.1:' + port, reuseExistingServer: false, timeout: 120000,
    env: { REACT_APP_DEPLOY_ENV: process.env.FEEDBACK_PAGES ? 'pages' : 'edgeone', VITE_QWERTY_SYNC_DISABLED: process.env.FEEDBACK_PAGES ? 'true' : 'false' } },
})
