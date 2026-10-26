import { defineConfig } from '@playwright/test'
import base from './circle-ui.config'

const port = Number(process.env.QWERTY_TEST_PORT || 4198)
export default defineConfig({
  ...base, outputDir: 'test-results/pages', testMatch: ['circle-ui-pages.spec.ts'],
  use: { ...base.use, baseURL: 'http://127.0.0.1:' + port },
  webServer: {
    command: 'yarn dev --host 127.0.0.1 --port ' + port,
    url: 'http://127.0.0.1:' + port + '/qwerty-learner/tests/e2e/backup-harness.html',
    reuseExistingServer: false, timeout: 120000,
    env: { REACT_APP_DEPLOY_ENV: 'pages', VITE_QWERTY_SYNC_DISABLED: 'true' },
  },
})
