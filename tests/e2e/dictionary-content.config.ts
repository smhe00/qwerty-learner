import base from './ui-visible.config'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  ...base,
  testMatch: 'dictionary-content.spec.ts',
  outputDir: 'test-results/dictionary-content',
  reporter: [['list'], ['json', { outputFile: 'test-results/dictionary-content-results.json' }]],
})
