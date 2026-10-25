import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: '.', testMatch: 'body-policy-runtime.spec.ts',
  workers: 1, retries: 0, reporter: 'list' })
