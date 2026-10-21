import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
const accountId = 'm2-local-ancestor-test'
async function init(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'm2-fixture-only',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: 'm2-local-ancestor-test', username: 'm2-e2e' },
    }))
    await h.initializeLegacyWorkspace({
      kind: 'account', accountId: 'm2-local-ancestor-test',
    })
  })
}
async function pin(page: Page) {
  return page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const identity = { kind: 'account', accountId: 'm2-local-ancestor-test' }
    const snapshot = await h.captureWorkingWorkspaceV4(identity)
    const fingerprint = await h.workspaceFingerprintV4(snapshot)
    const registry = await h.workspaceRegistryPort.read()
    const staged = { version: 1, accountId: identity.accountId,
      registryGeneration: registry.generation, revision: 7, fingerprint,
      oldBaseline: null, snapshot }
    await h.syncV2PullJournalPort.stage(staged)
    const recovered = await h.recoverPendingSyncV2Pull()
    const actual = await h.loadPinnedLocalS2PullAncestor(identity.accountId)
    return { recovered, fingerprint,
      snapshot: actual?.snapshot, revision: actual?.revision,
      status: actual?.status, verified: actual?.fingerprint,
      baseline: await h.loadSyncV2Baseline(identity.accountId),
    }
  })
}
test('real IDB S2 Pull commits full ancestor and matching baseline atomically', async ({ page }) => {
  await init(page)
  const result = await pin(page)
  expect(result.recovered).toBe(true)
  expect(result.revision).toBe(7)
  expect(result.verified).toBe(result.fingerprint)
  expect(result.baseline.baseRevision).toBe(7)
  expect(result.status).toBe('pinned-local-s2-pull-only')
  expect(result.snapshot.workspaceData.database.data.data).toHaveLength(6)
  await page.reload()
  const after = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const result = await h.loadPinnedLocalS2PullAncestor('m2-local-ancestor-test')
    return { status: result?.status, revision: result?.revision,
      sha: await h.workspaceFingerprintV4(result.snapshot) }
  })
  expect(after.revision).toBe(7)
  expect(after.sha).toBe(result.fingerprint)
})
test('baseline advanced by another sync invalidates local historical pin', async ({ page }) => {
  await init(page)
  await pin(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const old = await h.loadSyncV2Baseline('m2-local-ancestor-test')
    await h.compareAndSwapSyncV2Baseline('m2-local-ancestor-test', old,
      { accountId: 'm2-local-ancestor-test', baseRevision: 8,
        logicalFingerprint: 'a'.repeat(64) })
    try { await h.loadPinnedLocalS2PullAncestor('m2-local-ancestor-test')
      return 'unexpected success'
    } catch (error) { return String(error) }
  })
  expect(result).toContain('m2-ancestor-stale-s2-baseline')
})
test('corrupt archived V4 must fail closed without destroying preserved evidence', async ({ page }) => {
  await init(page)
  await pin(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const db = await h.openWorkspaceVault()
    const key = 'm2-s2pull-ancestor:m2-local-ancestor-test'
    const tx = db.transaction(['snapshots'], 'readwrite')
    const store = tx.objectStore('snapshots')
    const existing = await new Promise<any>((resolve, reject) => {
      const req = store.get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const parsed = JSON.parse(existing.snapshotJson)
    parsed.workspaceData.navigation.currentChapter = 88
    existing.snapshotJson = JSON.stringify(parsed)
    store.put(existing)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    let reason = ''
    try { await h.loadPinnedLocalS2PullAncestor('m2-local-ancestor-test')
    } catch (error) { reason = String(error) }
    return { reason, baseline: await h.loadSyncV2Baseline('m2-local-ancestor-test') }
  })
  expect(result.reason).toContain('m2-ancestor-fingerprint-or-account-mismatch')
  expect(result.baseline.baseRevision).toBe(7)
})
