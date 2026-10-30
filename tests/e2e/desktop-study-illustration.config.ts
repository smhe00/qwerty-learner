import base from './ui-visible.config'
import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  ...base,
  testMatch: 'desktop-study-illustration.spec.ts',
  outputDir: resolve('test-results/desktop-study-illustration'),
  reporter: [['list'], ['json', { outputFile: resolve('test-results/desktop-study-illustration-results.json') }]],
})
