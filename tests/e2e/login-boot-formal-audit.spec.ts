import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('bounded audit of actual M4 / S2 kernels, real Dexie merge, and network fault boundaries', async ({ page }) => {
  // No public server, real account or remote mutation belongs to this audit.
  await page.route('**/api/**', (route) => route.abort('blockedbyclient'))
  await page.goto('/tests/e2e/login-boot-formal-audit.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__loginBootAudit))).toBe(true)
  const proof = await page.evaluate(() => (window as any).__loginBootAudit())
  const destination = resolve('interactive/reports/evidence/LOGIN-BOOT-FORMAL-AUDIT-20261026')
  mkdirSync(destination, { recursive: true })
  writeFileSync(resolve(destination, 'actual-kernel-proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log('LOGIN_BOOT_AUDIT', JSON.stringify(proof))
  expect(proof.m4.baselineCleared).toBe(true)
  expect(proof.m4.journalCleared).toBe(true)
  expect(proof.sameLocalMerge.candidateEqualsLocal).toBe(true)
  expect(proof.sameLocalMerge.status).toBe('pull-reload-required')
  expect(proof.sameLocalMerge.stagedSnapshotEqualsLive).toBe(true)
  expect(proof.sameLocalMerge.afterRecoveryStatus).toBe('noop')
  expect(proof.faults.every((r: any) => r.safetyChecksPassed)).toBe(true)
  expect(proof.faults.find((r: any) => r.fault === 'commit-ack-lost').nextStatus).toBe('noop')
  expect(proof.optionalCheckout.publishedButPending).toBe(true)
})
