import { expect, test } from '@playwright/test'

test('large Unicode history survives independent audit, automatic merge and durable restore', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await page.waitForFunction(() => Boolean((window as any).__backupHarness?.captureWorkingWorkspaceV4))
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const results = []
    for (let pad = 0; pad < 3; pad++) {
      await h.clearAllTables()
      const rows = Array.from({ length: 700 }, (_, i) => {
        const shared = {
          name: 'unicode-' + i,
          trans: ['中文🙂é'.repeat(160), 'line\nquote"slash\\'],
          ...(i === 0 ? { 'audit.date': new Date('2026-10-24T00:00:00Z') } : {}),
        }
        return { id: i + 1, dict: 'cet4', index: 0, createTime: i + 1, isFinished: false, words: [shared, shared] }
      })
      // An escaped Typeson key forces the independent-IDB audit without
      // adding invalid/unsupported data or weakening that audit.
      Object.assign(rows[0], { padding: 'x'.repeat(pad) })
      await h.db.reviewRecords.bulkAdd(rows)
      const original = await h.db.reviewRecords.toCollection().raw().toArray()
      const rawBlob = await h.db.export()
      const snapshot = await h.captureWorkingWorkspaceV4({ kind: 'account', accountId: 'unicode-synthetic' })
      const sourceUnchanged = h.sameLosslessIndexedDbValue(original, await h.db.reviewRecords.toCollection().raw().toArray())
      await h.importBackupJson(await rawBlob.text())
      const legacyExact = h.sameLosslessIndexedDbValue(original, await h.db.reviewRecords.toCollection().raw().toArray())
      const audited = await h.materializeAuditedM4CandidateV4(snapshot, snapshot)
      await h.restoreWorkingWorkspaceV4(audited, { kind: 'account', accountId: 'unicode-synthetic' })
      const restoreExact = h.sameLosslessIndexedDbValue(original, await h.db.reviewRecords.toCollection().raw().toArray())
      const candidate = await h.mergeAccountV4Snapshots(snapshot, snapshot)
      await h.restoreWorkingWorkspaceV4(candidate, { kind: 'account', accountId: 'unicode-synthetic' })
      const actual = await h.db.reviewRecords.toCollection().raw().toArray()
      results.push({
        bytes: rawBlob.size,
        count: actual.length,
        sourceUnchanged,
        legacyExact,
        restoreExact,
        // Numeric IDs are intentionally remapped by automatic union. Compare
        // every remaining field paired by this fixture's unique createTime.
        exact: original.every((row: any) => {
          const restored = actual.find((r: any) => r.createTime === row.createTime)
          if (!restored) return false
          const left = { ...row },
            right = { ...restored }
          delete left.id
          delete right.id
          return h.sameLosslessIndexedDbValue(left, right)
        }),
        aliases: actual.every((row: any) => row.words[0] === row.words[1]),
        replacement: actual.some((row: any) => row.words[0].trans[0].includes('�')),
      })
    }
    return results
  })
  expect(result).toHaveLength(3)
  for (const row of result) {
    expect(row.bytes).toBeGreaterThan(1024 * 1024)
    expect(row).toMatchObject({
      count: 700,
      sourceUnchanged: true,
      legacyExact: true,
      restoreExact: true,
      exact: true,
      aliases: true,
      replacement: false,
    })
  }
})

test('JSON escape boundaries preserve Unicode code units through the real chunk parser', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await page.waitForFunction(() => Boolean((window as any).__backupHarness?.createDexieImportBlob))
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const Dexie = Object.getPrototypeOf(Object.getPrototypeOf(h.db)).constructor
    const results = []
    const row = {
      id: 1,
      '键🙂': ['中文', 'é', '🙂', '\ud800', '\udfff', '\u0000\n\t', '\\u4e2d', '"'],
      nested: { array: [undefined, NaN, Infinity], date: new Date('2026-10-24T00:00:00Z') },
    }
    const source = new Dexie('unicode-code-unit-source')
    source.version(1).stores({ records: 'id' })
    try {
      await source.table('records').add(row)
      const original = await source.table('records').get(1)
      const exported = JSON.parse(await (await source.export()).text())
      for (let chunk = 61; chunk <= 72; chunk++) {
        const name = 'unicode-code-unit-target-' + chunk
        const target = new Dexie(name)
        target.version(1).stores({ records: 'id' })
        const encoded = { ...exported, data: { ...exported.data, databaseName: name } }
        const blob = h.createDexieImportBlob(JSON.stringify(encoded))
        try {
          const text = await blob.text()
          await target.import(blob, { chunkSizeBytes: chunk })
          results.push({
            ascii: /^[\x00-\x7f]*$/.test(text),
            jsonExact: JSON.stringify(JSON.parse(text)) === JSON.stringify(encoded),
            exact: h.sameLosslessIndexedDbValue(original, await target.table('records').get(1)),
          })
        } finally {
          target.close()
          await target.delete()
        }
      }
    } finally {
      source.close()
      await source.delete()
    }
    return results
  })
  expect(result).toHaveLength(12)
  expect(result.every((row) => row.ascii && row.jsonExact && row.exact)).toBe(true)
})

test('M4 candidate preserves a large Unicode ReviewRecord before any live restore', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await page.waitForFunction(() => Boolean((window as any).__backupHarness?.captureWorkingWorkspaceV4))
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.clearAllTables()
    const shared = { name: 'm4-unicode', trans: ['中文🙂é'.repeat(110000)] }
    await h.db.reviewRecords.add({ id: 1, dict: 'cet4', index: 0, createTime: 1, isFinished: false, words: [shared, shared] })
    const original = await h.db.reviewRecords.toCollection().raw().first()
    const source = { kind: 'account', accountId: 'm4-unicode-synthetic' }
    const snapshot = await h.captureWorkingWorkspaceV4(source)
    const candidate = await h.materializeAuditedM4CandidateV4(snapshot, snapshot)
    const sourceUnchanged = h.sameLosslessIndexedDbValue(original, await h.db.reviewRecords.toCollection().raw().first())
    await h.restoreWorkingWorkspaceV4(candidate, source)
    const actual = await h.db.reviewRecords.toCollection().raw().first()
    return { sourceUnchanged, restoredExact: h.sameLosslessIndexedDbValue(original, actual) }
  })
  expect(result).toEqual({ sourceUnchanged: true, restoredExact: true })
})
