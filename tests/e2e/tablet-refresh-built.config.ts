import base from './mobile-p0.config'
import { defineConfig } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4195'
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  ...base,
  testMatch: ['tablet-refresh.spec.ts'],
  use: { ...base.use, baseURL },
  webServer: {
    command: 'yarn vite preview --host 127.0.0.1 --port ' + port,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
