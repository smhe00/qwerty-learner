import { defineConfig, devices } from '@playwright/test'

const port = process.env.QWERTY_TEST_PORT || '4173'
const baseURL = 'http://127.0.0.1:' + port

export default defineConfig({
  testDir: '.',
  testMatch: [
    'learn-review-flow.spec.ts',
    'learn-shell-ui.spec.ts',
    'default-learn-header.spec.ts',
    'settings-mode-navigation.spec.ts',
    'toolbar-icon-focus.spec.ts',
    'focus-ui.spec.ts',
    'focus-p0-final-acceptance.spec.ts',
    'focus-p1-journey.spec.ts',
    'focus-p2-accessibility.spec.ts',
    'navigation-dialogs.spec.ts',
    'learn-recovery-flow.spec.ts',
    'learn-acquisition-flow.spec.ts',
    'learn-block-size.spec.ts',
    'learn-extra-words.spec.ts',
    'learn-legacy-compat.spec.ts',
  ],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'yarn dev --host 127.0.0.1 --port ' + port,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
})
