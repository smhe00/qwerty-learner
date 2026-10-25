import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['idle-cleanup.spec.ts', 'account-continuity.spec.ts', 'mobile-account-writer.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4197', viewport: { width: 1280, height: 800 },
    channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? undefined : 'chrome',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : undefined },
  webServer: { cwd: process.cwd(), command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4197',
    url: 'http://127.0.0.1:4197', reuseExistingServer: false, timeout: 120_000 },
})
