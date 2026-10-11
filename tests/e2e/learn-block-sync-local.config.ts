import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'learn-block-sync-ui.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: 'chrome',
    baseURL: 'http://127.0.0.1:4175' },
  projects: [{ name: 'chromium' }],
  webServer: { command: 'yarn vite --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false, timeout: 60000 },
})