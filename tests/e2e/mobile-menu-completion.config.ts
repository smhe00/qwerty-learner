import { defineConfig } from '@playwright/test'
import base from './mobile-p0.config'

export default defineConfig({
  ...base,
  timeout: 60_000,
  testMatch: ['mobile-menu-completion.spec.ts', 'mobile-p0.spec.ts', 'mobile-learning-loop.spec.ts', 'mobile-account.spec.ts'],
  grep: /menu completion:|Mobile keeps the independent app menu|settings validate bounds|dictionary selection cancels|both phone menu entries/,
})
