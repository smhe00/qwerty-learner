import { expect, test, type Page } from '@playwright/test'

async function ready(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.loadSyncV2Baseline),
  )).toBe(true)
}

const A = 's2-immutable-account-A'
const B = 's2-immutable-account-B'
const one = { accountId: A, baseRevision: 3, logicalFingerprint: 'a'.repeat(64) }
const two = { accountId: A, baseRevision: 4, logicalFingerprint: 'b'.repeat(64) }

test('S2 IndexedDB baseline survives page reload without replacing S1 registry HEAD', async ({ page }) => {
  await ready(page)
  const first = await page.evaluate(async baseline => {
    const h = (window as any).__backupHarness
    const originalRegistry = await h.workspaceRegistryPort.read()
    const absent = await h.loadSyncV2Baseline(baseline.accountId)
    await h.compareAndSwapSyncV2Baseline(baseline.accountId, null, baseline)
    return {
      absent,
      initialGeneration: originalRegistry.generation,
      generationAfter: (await h.workspaceRegistryPort.read()).generation,
    }
  }, one)
  expect(first).toEqual({ absent: null, initialGeneration: 0, generationAfter: 0 })
  await page.reload()
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.loadSyncV2Baseline),
  )).toBe(true)
  const observed = await page.evaluate(async ([a, b]: string[]) => {
    const h = (window as any).__backupHarness
    return {
      a: await h.loadSyncV2Baseline(a),
      b: await h.loadSyncV2Baseline(b),
      owner: (await h.workspaceRegistryPort.read()).active,
    }
  }, [A, B])
  expect(observed.a).toEqual(one)
  expect(observed.b).toBeNull()
  expect(observed.owner).toEqual({ kind: 'anonymous' })
})

test('S2 IndexedDB compare-and-swap prevents stale device revision and hash rewrite', async ({ page, context }) => {
  await ready(page)
  await page.evaluate(async baseline => {
    const h = (window as any).__backupHarness
    await h.compareAndSwapSyncV2Baseline(baseline.accountId, null, baseline)
  }, one)
  const second = await context.newPage()
  await ready(second)
  const mismatch = await second.evaluate(async ([old, next]: Array<{accountId: string; baseRevision: number; logicalFingerprint: string}>) => {
    const h = (window as any).__backupHarness
    let stale = ''
    try {
      await h.compareAndSwapSyncV2Baseline(old.accountId, null, next)
    } catch (error) { stale = String(error) }
    await h.compareAndSwapSyncV2Baseline(old.accountId, old, next)
    let duplicate = ''
    try {
      await h.compareAndSwapSyncV2Baseline(old.accountId, old, {
        ...next, baseRevision: next.baseRevision + 1,
      })
    } catch (error) { duplicate = String(error) }
    return {
      stale,
      duplicate,
      current: await h.loadSyncV2Baseline(old.accountId),
    }
  }, [one, two])
  expect(mismatch.stale).toMatch(/CAS conflict/)
  expect(mismatch.duplicate).toMatch(/CAS conflict/)
  expect(mismatch.current).toEqual(two)
  await second.close()
})
