import { uiPath } from './ui-test-path'
import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const port = process.env.QWERTY_TEST_PORT || '4207'
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  testDir: '.',
  testMatch: ['ui-visible.spec.ts'],
  fullyParallel: true,
  workers: 2,
  timeout: 180_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: resolve('test-results/ui-visible-results.json') }]],
  outputDir: resolve('test-results/ui-visible'),
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  webServer: { command: 'yarn vite preview --host 127.0.0.1 --port ' + port, url: baseURL + uiPath('/'), reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: 'phone-light', use: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, colorScheme: 'light' } },
    { name: 'phone-dark', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' } },
    { name: 'tablet-light', use: { viewport: { width: 1024, height: 600 }, hasTouch: true, colorScheme: 'light' } },
    { name: 'tablet-dark', use: { viewport: { width: 1024, height: 600 }, hasTouch: true, colorScheme: 'dark' } },
    { name: 'desktop-light', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  ],
})
