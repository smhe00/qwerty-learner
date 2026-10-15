import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: [
    'beta-rc-branding.spec.ts',
    'data-cloud-visibility.spec.ts',
    'data-capacity-presentation.spec.ts',
    'developer-settings-style.spec.ts',
    'workspace-v4-import-copy-id.spec.ts',
    'focus-p2-accessibility.spec.ts',
    'focus-ui.spec.ts',
  ],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 100_000,
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
