import { resolve } from 'node:path'
import { uiPath } from './ui-test-path'
import base from './mobile-p0.config'
import { defineConfig } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4195'
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  ...base,
  outputDir: resolve('test-results/touch-built'),
  testMatch: ['tablet-refresh.spec.ts', 'mobile-action-visibility.spec.ts'],
  use: { ...base.use, baseURL },
  webServer: {
    command: 'yarn vite preview --host 127.0.0.1 --port ' + port,
    url: baseURL + uiPath('/'),
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
