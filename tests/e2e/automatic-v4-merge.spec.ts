import { expect, test } from '@playwright/test'

test('automatic six-table merge archives both copies, preserves aliases, remaps references and restores exactly', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => !!(window as any).__backupHarness)).toBe(true)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const { mergeAccountV4Snapshots, archiveAutomaticV4Merge } = h
    const owner = { kind: 'account' as const, accountId: 'auto-merge-browser-test' }
    await h.seed()
    localStorage.setItem(
      'qwerty.cloudAuth.v1',
      JSON.stringify({
        token: 'isolated-test-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: { userId: owner.accountId, username: 'auto-merge-test' },
      }),
    )
    const registry = await h.initializeLegacyWorkspace(owner)
    const shared = { name: 'alias', trans: ['synthetic'] }
    await h.db.reviewRecords.add({ dict: 'cet4', index: 0, createTime: 10, isFinished: false, words: [shared, shared] })
    const base = await h.captureWorkingWorkspaceV4(owner)
    const add = async (word: string) => {
      const id = await h.db.wordRecords.add({
        word,
        dict: 'cet4',
        chapter: 0,
        timeStamp: 1_800_000_000,
        timing: [100],
        wrongCount: 0,
        mistakes: {},
      })
      await h.db.chapterRecords.add({ dict: 'cet4', chapter: 2, wordRecordIds: [id], timeStamp: 1_800_000_000 })
    }
    await add('left-fork')
    const left = await h.captureWorkingWorkspaceV4(owner)
    await h.restoreWorkingWorkspaceV4(base, owner)
    await add('right-fork')
    const right = await h.captureWorkingWorkspaceV4(owner)
    await h.restoreWorkingWorkspaceV4(left, owner)
    const before = await h.workspaceFingerprintV4(await h.captureWorkingWorkspaceV4(owner))
    const merged = await mergeAccountV4Snapshots(left, right)
    const candidate = await h.workspaceFingerprintV4(merged)
    const untouched = before === (await h.workspaceFingerprintV4(await h.captureWorkingWorkspaceV4(owner)))
    await archiveAutomaticV4Merge(owner.accountId, registry.generation, left, right, merged)
    const vault = await h.openWorkspaceVault()
    const archives = await new Promise<any[]>((ok, fail) => {
      const r = vault.transaction('snapshots').objectStore('snapshots').getAll()
      r.onsuccess = () => ok(r.result)
      r.onerror = () => fail(r.error)
    })
    vault.close()
    const saved = archives.filter((r) => r.key.startsWith('auto-v4-merge:'))
    await h.restoreWorkingWorkspaceV4(merged, owner)
    const restored = await h.captureWorkingWorkspaceV4(owner)
    const actual = await h.workspaceFingerprintV4(restored)
    const words = await h.db.wordRecords.toArray()
    const chapters = await h.db.chapterRecords.toArray()
    const reviews = await h.db.reviewRecords.toArray()
    const aliased = reviews.find((r: any) => r.createTime === 10)
    const again = await mergeAccountV4Snapshots(merged, right)
    const inverse = await mergeAccountV4Snapshots(right, left)
    // Corrupted pre-existing archive must stop a new reconciliation; never
    // overwrite the evidence and continue a cloud mutation.
    const corruptVault = await h.openWorkspaceVault()
    await new Promise<void>((ok, fail) => {
      const tx = corruptVault.transaction('snapshots', 'readwrite')
      tx.objectStore('snapshots').put({ ...saved[0], json: '{}' })
      tx.oncomplete = () => ok()
      tx.onabort = () => fail(tx.error)
    })
    corruptVault.close()
    let corruptArchiveRejected = false
    try { await archiveAutomaticV4Merge(owner.accountId, registry.generation, left, right, merged) }
    catch { corruptArchiveRejected = true }
    return {
      corruptArchiveRejected,
      untouched,
      actual,
      candidate,
      again: await h.workspaceFingerprintV4(again),
      inverse: await h.workspaceFingerprintV4(inverse),
      names: words.map((r: any) => r.word).sort(),
      chapterNames: chapters
        .filter((r: any) => r.chapter === 2)
        .map((r: any) => words.find((w: any) => w.id === r.wordRecordIds[0]).word)
        .sort(),
      alias: aliased.words[0] === aliased.words[1],
      archives: saved.map((r) => r.fingerprint).sort(),
      expectedArchives: [await h.workspaceFingerprintV4(left), await h.workspaceFingerprintV4(right), candidate].sort(),
    }
  })
  expect(result.corruptArchiveRejected).toBe(true)
  expect(result.untouched).toBe(true)
  expect(result.actual).toBe(result.candidate)
  expect(result.again).toBe(result.candidate)
  expect(result.inverse).toBe(result.candidate)
  expect(result.names).toContain('left-fork')
  expect(result.names).toContain('right-fork')
  expect(result.chapterNames).toEqual(['left-fork', 'right-fork'])
  expect(result.alias).toBe(true)
  expect(result.archives).toEqual(result.expectedArchives)
})
