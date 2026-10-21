import { expect, test } from '@playwright/test'

const owner = { kind: 'account' as const, accountId: 'm4-pilot-browser-test' }

async function init(page: import('@playwright/test').Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async identity => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(identity)
  }, owner)
}

async function stage(page: import('@playwright/test').Page, candidateChapter: number) {
  return page.evaluate(async (input) => {
    const h = (window as any).__backupHarness
    const original = await h.captureWorkingWorkspaceV4(input.owner)
    const candidate = structuredClone(original)
    candidate.workspaceData.navigation.currentChapter = input.candidateChapter
    const registry = await h.workspaceRegistryPort.read()
    const pending = {
      version: 1,
      accountId: input.owner.accountId,
      registryGeneration: registry.generation,
      originalFingerprint: await h.workspaceFingerprintV4(original),
      candidateFingerprint: await h.workspaceFingerprintV4(candidate),
      original,
      candidate,
    }
    await h.m4MergeJournalPort.stage(pending)
    const observed = await h.m4MergeJournalPort.read()
    return { originalFingerprint: pending.originalFingerprint,
      candidateFingerprint: pending.candidateFingerprint,
      staged: observed !== null,
      registryGeneration: registry.generation }
  }, { owner, candidateChapter })
}

test('real IndexedDB: crash after M4 staging keeps six-table rollback and restores after reload', async ({ page }) => {
  await init(page)
  const expected = await stage(page, 29)
  expect(expected.staged).toBe(true)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    // Simulate a torn/destructive working RecordDB operation AFTER durable stage.
    await h.db.wordRecords.clear()
    localStorage.setItem('currentChapter', JSON.stringify(88))
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.m4MergeJournalPort?.read))).toBe(true)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const pendingBefore = await h.m4MergeJournalPort.read()
    const emptyBefore = await h.db.wordRecords.count()
    const restored = await h.recoverPendingM4Merge('rollback')
    const snapshot = await h.captureWorkingWorkspaceV4({
      kind: 'account', accountId: 'm4-pilot-browser-test',
    })
    return { hadPending: pendingBefore !== null, emptyBefore,
      restored, after: await h.workspaceFingerprintV4(snapshot),
      pendingAfter: await h.m4MergeJournalPort.read(),
      count: await h.db.wordRecords.count(),
      chapter: snapshot.workspaceData.navigation.currentChapter }
  })
  expect(result.hadPending).toBe(true)
  expect(result.emptyBefore).toBe(0)
  expect(result.restored).toBe(true)
  expect(result.after).toBe(expected.originalFingerprint)
  expect(result.pendingAfter).toBeNull()
  expect(result.count).toBeGreaterThan(0)
  expect(result.chapter).not.toBe(29)
})

test('real IndexedDB: verified candidate apply clears journal only after full V4 readback', async ({ page }) => {
  await init(page)
  const expected = await stage(page, 31)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const applied = await h.recoverPendingM4Merge('apply')
    const snap = await h.captureWorkingWorkspaceV4({
      kind: 'account', accountId: 'm4-pilot-browser-test',
    })
    return { applied, fingerprint: await h.workspaceFingerprintV4(snap),
      chapter: snap.workspaceData.navigation.currentChapter,
      pending: await h.m4MergeJournalPort.read() }
  })
  expect(result.applied).toBe(true)
  expect(result.fingerprint).toBe(expected.candidateFingerprint)
  expect(result.chapter).toBe(31)
  expect(result.pending).toBeNull()
})

test('real IndexedDB: staging a manual V4 import is refused while M4 transaction is pending', async ({ page }) => {
  await init(page)
  await stage(page, 32)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const owner = { kind: 'account', accountId: 'm4-pilot-browser-test' }
    const original = await h.captureWorkingWorkspaceV4(owner)
    const generation = (await h.workspaceRegistryPort.read()).generation
    let blocked = false
    try {
      await h.manualV4ImportJournalPort.stage({
        owner, originalOwner: owner, registryGeneration: generation,
        original, candidate: original,
      })
    } catch (error) {
      blocked = String(error).includes('conflicts with another S1/S2 transaction')
    }
    const pending = await h.m4MergeJournalPort.read()
    return { blocked, m4Preserved: pending !== null }
  })
  expect(result.blocked).toBe(true)
  expect(result.m4Preserved).toBe(true)
})
