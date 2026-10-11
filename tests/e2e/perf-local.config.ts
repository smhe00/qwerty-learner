import { defineConfig, devices } from '@playwright/test'

/**
 * Isolated preview smoke; never contacts the production EdgeOne workspace.
 * Build before running: yarn build && yarn playwright test --config tests/e2e/perf-local.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'perf-report-local.spec.ts',
  reporter: 'list',
  retries: 0,
  workers: 1,
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4173',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'yarn vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
