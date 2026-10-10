import { expect, test, type Page } from '@playwright/test'

const account = { kind: 'account' as const, accountId: 's2-real-pull-A' }
async function ready(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.syncV2PullJournalPort),
  )).toBe(true)
}
async function stage(page: Page) {
  return page.evaluate(async owner => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'test-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: owner.accountId, username: 's2-user' },
    }))
    const registry = await h.initializeLegacyWorkspace(owner)
    const cloud = await h.captureWorkingWorkspaceV4(owner)
    cloud.workspaceData.navigation.currentChapter = 14
    const fingerprint = await h.workspaceFingerprintV4(cloud)
    await h.syncV2PullJournalPort.stage({
      version: 1, accountId: owner.accountId, registryGeneration: registry.generation,
      revision: 7, fingerprint, oldBaseline: null, snapshot: cloud,
    })
    await h.poisonBeforeRestore()
    return { pending: !!(await h.syncV2PullJournalPort.read()),
      poison: (await h.inspect()).currentChapter }
  }, account)
}

test('crashed V4 Pull is replayed before S1 app mount and requires a fresh realm', async ({ page }) => {
  await ready(page)
  expect(await stage(page)).toEqual({ pending: true, poison: 99 })
  await page.reload()
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.mountGuardedWorkspaceApp),
  )).toBe(true)
  const recovered = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const phases: string[] = []
    let mounted = false, error = ''
    try {
      await h.mountGuardedWorkspaceApp(() => { mounted = true },
        (p: string) => phases.push(p))
    } catch (e) { error = String(e) }
    return { phases, mounted, error,
      pending: await h.syncV2PullJournalPort.read(),
      baseline: await h.loadSyncV2Baseline('s2-real-pull-A'),
      state: await h.inspect() }
  })
  expect(recovered.mounted).toBe(false)
  expect(recovered.error).toMatch(/S2 Pull recovery completed; reload required/)
  expect(recovered.phases).toEqual(['locking','checking-identity','recovering','restart-required'])
  expect(recovered.pending).toBeNull()
  expect(recovered.baseline.baseRevision).toBe(7)
  expect(recovered.state.currentChapter).toBe(14)
  expect(recovered.state.wordRecord).not.toBeNull()
  await page.reload()
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.mountGuardedWorkspaceApp),
  )).toBe(true)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    let mounted = false
    const boot = await h.mountGuardedWorkspaceApp(() => { mounted = true })
    boot.release()
    return { mounted, mode: boot.mode }
  })
  expect(result).toEqual({ mounted: true, mode: 'isolated' })
})

test('damaged staged V4 fingerprint fails closed without touching saved baseline', async ({ page }) => {
  await ready(page)
  await stage(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const db = await h.openWorkspaceVault()
    const tx = db.transaction('registry', 'readwrite')
    const store = tx.objectStore('registry')
    const raw = await new Promise<any>((resolve, reject) => {
      const q = store.get('sync-v2-pull-journal:v1')
      q.onsuccess = () => resolve(q.result)
      q.onerror = () => reject(q.error)
    })
    raw.fingerprint = 'f'.repeat(64)
    store.put(raw, 'sync-v2-pull-journal:v1')
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.mountGuardedWorkspaceApp),
  )).toBe(true)
  const outcome = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    let mounted = false, error = ''
    try { await h.mountGuardedWorkspaceApp(() => { mounted = true }) }
    catch (e) { error = String(e) }
    return { mounted, error, baseline: await h.loadSyncV2Baseline('s2-real-pull-A') }
  })
  expect(outcome.mounted).toBe(false)
  expect(outcome.error).toMatch(/journal snapshot integrity/)
  expect(outcome.baseline).toBeNull()
})
