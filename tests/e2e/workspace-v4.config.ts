import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['workspace-v4.spec.ts', 'workspace-v4-app.spec.ts', 'workspace-v4-boot.spec.ts', 'workspace-v4-s2-baseline.spec.ts', 'workspace-v4-s2-pull.spec.ts', 'workspace-app-entry.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4178',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'yarn dev --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178/tests/e2e/backup-harness.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } }],
})
