import { expect, test, type Page } from '@playwright/test'

const accountA = { kind: 'account', accountId: 'immutable-account-A' }
const accountB = { kind: 'account', accountId: 'immutable-account-B' }

async function ready(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(async () =>
    page.evaluate(() => Boolean((window as any).__backupHarness?.captureWorkingWorkspaceV4)),
  ).toBe(true)
}

test('actual Dexie/FSRS/achievement/unfinished DailySession V4 roundtrip preserves isolation', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async ({ a, b }) => {
    const h = (window as any).__backupHarness
    await h.seed()
    const session = {
      version: 1, sessionId: 'cet4:2026-10-09:1', dict: 'cet4', dateKey: '2026-10-09',
      startedAt: 100, status: 'active', dailyNewTarget: 32,
      plannedNewWords: 4, plannedReviewWords: ['backup-fsrs-word'],
      carryOverAcquisitionWords: ['carry'], accumulatedActiveSeconds: 190,
      completedBlockIds: ['block-1'], blockCount: 1,
    }
    localStorage.setItem('qwerty.learn.dailySession.v1.cet4', JSON.stringify(session))
    localStorage.setItem('memoryConfig', JSON.stringify({ dailyNewWordTarget: 32, blockSize: 1 }))
    localStorage.setItem('pronunciation', JSON.stringify({ isOpen: false, volume: 0.3 }))
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ token: 'MUST_NOT_EXPORT' }))
    const original = await h.captureWorkingWorkspaceV4(a)
    const fingerprint = await h.workspaceFingerprintV4(original)
    await h.saveWorkspaceToVault(a, original)
    const loaded = await h.loadWorkspaceFromVault(a)
    const sameHash = await h.workspaceFingerprintV4(loaded)
    const forbidden = JSON.stringify(loaded).includes('MUST_NOT_EXPORT')
    await h.resetWorkingWorkspaceToEmpty()
    const blank = await h.inspect()
    const clearedSession = localStorage.getItem('qwerty.learn.dailySession.v1.cet4')
    const clearedSettings = localStorage.getItem('memoryConfig')
    let foreignRestoreRejected = false
    try { await h.restoreWorkingWorkspaceV4(loaded, b) } catch { foreignRestoreRejected = true }
    await h.restoreWorkingWorkspaceV4(loaded, a)
    const restored = await h.inspect()
    return {
      fingerprint, sameHash, forbidden, foreignRestoreRejected,
      blankWord: blank.wordRecord ?? null,
      clearedSession, clearedSettings,
      restoredWord: restored.wordRecord?.word,
      restoredFSRS: restored.wordRecord?.fsrsShadow?.algorithmModel,
      restoredReviewIndex: restored.reviewRecord?.index,
      restoredAchievement: restored.achievementEvent?.eventId,
      restoredDict: restored.currentDict,
      restoredChapter: restored.currentChapter,
      restoredSession: JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4') ?? 'null'),
      restoredSettings: JSON.parse(localStorage.getItem('memoryConfig') ?? 'null'),
    }
  }, { a: accountA, b: accountB })
  expect(result.sameHash).toBe(result.fingerprint)
  expect(result.forbidden).toBe(false)
  expect(result.foreignRestoreRejected).toBe(true)
  expect(result.blankWord).toBeNull()
  expect(result.clearedSession).toBeNull()
  expect(result.clearedSettings).toBeNull()
  expect(result.restoredWord).toBe('backup-fsrs-word')
  expect(result.restoredFSRS).toBe('fsrs-6')
  expect(result.restoredReviewIndex).toBe(0)
  expect(result.restoredAchievement).toBe('backup-achievement-event')
  expect(result.restoredDict).toBe('cet4')
  expect(result.restoredChapter).toBe(3)
  expect(result.restoredSession.completedBlockIds).toEqual(['block-1'])
  expect(result.restoredSettings.blockSize).toBe(1)
})

test('real IndexedDB CAS fences conflicting browser tabs', async ({ page, context }) => {
  await ready(page)
  const sibling = await context.newPage()
  await ready(sibling)
  const first = await page.evaluate(() => (window as any).__backupHarness.workspaceRegistryPort.read())
  const second = await sibling.evaluate(() => (window as any).__backupHarness.workspaceRegistryPort.read())
  expect(first.generation).toBe(second.generation)
  const submit = async (target: Page, base: typeof first) =>
    target.evaluate(async (r) => {
      const p = (window as any).__backupHarness.workspaceRegistryPort
      try {
        await p.compareAndSwap(r.generation, {
          ...r, generation: r.generation + 1,
        })
        return 'success'
      } catch { return 'cas-conflict' }
    }, base)
  const outcome = await Promise.all([submit(page, first), submit(sibling, second)])
  expect(outcome.sort()).toEqual(['cas-conflict', 'success'])
  const seen = await sibling.evaluate(() => (window as any).__backupHarness.workspaceRegistryPort.read())
  expect(seen.generation).toBe(first.generation + 1)
  await sibling.close()
})

test('pending switch journal survives reload and restores deterministically', async ({ page }) => {
  await ready(page)
  const outcome = await page.evaluate(async (a) => {
    const h = (window as any).__backupHarness
    const fake = {
      flush: async () => {},
      saveSource: async () => {},
      restoreTarget: async () => { throw new Error('crashed during target restore') },
    }
    try { await h.switchWorkspace(h.workspaceRegistryPort, fake, a) } catch {}
    return h.workspaceRegistryPort.read()
  }, accountA)
  expect(outcome.pending?.to).toEqual(accountA)
  expect(outcome.active).toEqual({ kind: 'anonymous' })
  await page.reload()
  await expect.poll(async () =>
    page.evaluate(() => Boolean((window as any).__backupHarness?.recoverWorkspace)),
  ).toBe(true)
  const recovered = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return h.recoverWorkspace(h.workspaceRegistryPort, {
      restoreTarget: async target => localStorage.setItem('lastRecovered', JSON.stringify(target)),
    })
  })
  expect(recovered.pending).toBeNull()
  expect(recovered.active).toEqual(accountA)
  expect(recovered.generation).toBe(2)
  const once = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return h.recoverWorkspace(h.workspaceRegistryPort, {
      restoreTarget: async () => { throw new Error('recovery unexpectedly retried') },
    })
  })
  expect(once.generation).toBe(2)
})

test('corrupted vault checksum never silently produces an empty account', async ({ page }) => {
  await ready(page)
  const state = await page.evaluate(async (a) => {
    const h = (window as any).__backupHarness
    const snapshot = h.createWorkspaceV4({
      database: { data: { tables: [], data: [] } },
      learnRuntime: { dailySessions: {} },
      settings: { version: 1, values: {} },
      navigation: { currentDict: 'cet4', currentChapter: 0 },
    }, { createdAt: '2026-10-09T00:00:00Z', source: a })
    await h.saveWorkspaceToVault(a, snapshot)
    const database = await h.openWorkspaceVault()
    await new Promise((resolve, reject) => {
      const tx = database.transaction('snapshots', 'readwrite')
      const store = tx.objectStore('snapshots')
      const key = 'account:' + encodeURIComponent(a.accountId)
      const req = store.get(key)
      req.onsuccess = () => {
        const value = req.result
        store.put({ ...value, fingerprint: '0'.repeat(64) })
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    database.close()
    try {
      await h.loadWorkspaceFromVault(a)
      return 'WRONG_SILENT_SUCCESS'
    } catch (error) { return String(error) }
  }, accountA)
  expect(state).toMatch(/integrity mismatch/)
})

test('under an exclusive tab lease, anonymous and account snapshots remain physically isolated', async ({ page }) => {
  await ready(page)
  const outcome = await page.evaluate(async (a) => {
    const h = (window as any).__backupHarness
    const lease = await h.acquireWorkspaceWriterLease()
    try {
      await h.seed()
      const original = await h.db.wordRecords.toArray()
      if (!original.some((r: any) => r.word === 'backup-fsrs-word')) throw Error('no anonymous fixture')
      await h.initializeLegacyWorkspace(h.ANONYMOUS)
      await h.transitionWorkingWorkspace(a)
      const firstAccount = await h.db.wordRecords.toArray()
      await h.db.wordRecords.add({
        word: 'A-ONLY-PRIVATE', dict: 'cet4', chapter: 0,
        timeStamp: 1, wrongCount: 0, mistakes: {}, timing: [100],
      })
      await h.transitionWorkingWorkspace(h.ANONYMOUS)
      const backToAnonymous = (await h.db.wordRecords.toArray()).map((r: any) => r.word)
      await h.transitionWorkingWorkspace(a)
      const backToA = (await h.db.wordRecords.toArray()).map((r: any) => r.word)
      const registry = await h.workspaceRegistryPort.read()
      return { firstAccount: firstAccount.length, backToAnonymous, backToA, registry }
    } finally {
      lease.release()
    }
  }, accountA)
  expect(outcome.firstAccount).toBe(0)
  expect(outcome.backToAnonymous).toContain('backup-fsrs-word')
  expect(outcome.backToAnonymous).not.toContain('A-ONLY-PRIVATE')
  expect(outcome.backToA).toContain('A-ONLY-PRIVATE')
  expect(outcome.backToA).not.toContain('backup-fsrs-word')
  expect(outcome.registry.active).toEqual(accountA)
  expect(outcome.registry.pending).toBeNull()
})

test('Web Locks refuses a second writing tab until first lease is released', async ({ page, context }) => {
  await ready(page)
  const sibling = await context.newPage()
  await ready(sibling)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    ;(window as any).__workspaceLease = await h.acquireWorkspaceWriterLease()
  })
  const secondStatus = await sibling.evaluate(async () => {
    try {
      const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
      lease.release()
      return 'incorrectly-acquired'
    } catch { return 'busy' }
  })
  expect(secondStatus).toBe('busy')
  await page.evaluate(() => (window as any).__workspaceLease.release())
  await expect.poll(async () => sibling.evaluate(async () => {
    try {
      const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
      lease.release()
      return 'acquired'
    } catch { return 'busy' }
  })).toBe('acquired')
  await sibling.close()
})
