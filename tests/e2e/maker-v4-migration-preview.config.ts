import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['maker-v4-migration-preview.spec.ts'],
  timeout: 120_000,
  reporter: [['list']],
  retries: 0,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4188',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'yarn vite preview --host 127.0.0.1 --port 4188 --strictPort',
    url: 'http://127.0.0.1:4188/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
