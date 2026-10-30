import base from './ui-visible.config'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  ...base,
  testMatch: 'desktop-study-illustration.spec.ts',
  outputDir: 'test-results/desktop-study-illustration',
  reporter: [['list'], ['json', { outputFile: 'test-results/desktop-study-illustration-results.json' }]],
})
