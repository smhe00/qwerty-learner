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


test('real Dexie telemetry containing special JS values exports V4 without losing metrics', async ({ page }) => {
  await ready(page)
  const observed = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    const initial = await h.db.wordRecords.where('word').equals('backup-fsrs-word').first()
    if (!initial?.id) throw Error('Fixture wordRecord missing')
    await h.db.wordRecords.update(initial.id, {
      typingTelemetry: {
        telemetryVersion: 2,
        firstKeyLatencyMs: NaN,
        attempts: [
          {
            startLatencyMs: Infinity,
            durationMs: 233,
            correctPrefixLength: 0,
            result: 'wrong',
            wrongIndex: undefined,
            interKeyIntervalsMs: [32, NaN],
          },
        ],
      },
    })
    // Synthetic telemetry only, never real user records. Keep a redacted
    // diagnostic of the actual Dexie encoder if the V4 audit rejects it.
    const rawRows = await h.db.wordRecords.toCollection().raw().toArray()
    const source = rawRows.find((row: any) => row.id === initial.id)
    const archive = JSON.parse(await h.exportBackupJson())
    const serialized = archive.database.data.data
      .find((item: any) => item.tableName === 'wordRecords')
      .rows.find((row: any) => row.id === initial.id)
    let snapshot
    try {
      snapshot = await h.captureWorkingWorkspaceV4({
        kind: 'account', accountId: 'telemetry-regression-account',
      })
    } catch (error) {
      return {
        failure: String(error),
        sourceTelemetry: JSON.parse(JSON.stringify(source.typingTelemetry)),
        sourceKinds: {
          firstKeyLatencyMs: typeof source.typingTelemetry.firstKeyLatencyMs,
          firstKeyIsNaN: Number.isNaN(source.typingTelemetry.firstKeyLatencyMs),
          startLatencyMs: source.typingTelemetry.attempts[0].startLatencyMs,
          wrongIndexExists: Object.prototype.hasOwnProperty.call(
            source.typingTelemetry.attempts[0], 'wrongIndex'),
        },
        serializedTelemetry: serialized.typingTelemetry,
        exportTypes: serialized.$types || null,
      }
    }
    const exported = snapshot.workspaceData.database.data.data
      .find((item: any) => item.tableName === 'wordRecords')
      .rows.find((row: any) => row.id === initial.id)
    return {
      format: snapshot.backupFormatVersion,
      rawTags: Object.values(exported.$types || {}).sort(),
      serializedLatency: exported.typingTelemetry.firstKeyLatencyMs,
      serializedDuration: exported.typingTelemetry.attempts[0].durationMs,
      originalUnchanged: (
        await h.db.wordRecords.toCollection().raw().toArray()
      ).find((row: any) => row.id === initial.id)?.typingTelemetry?.attempts?.[0]?.durationMs,
    }
  })
  if (observed.failure) {
    console.log('SYNTHETIC_DEXIE_TELEMETRY_DIAGNOSTIC', JSON.stringify(observed))
  }
  expect(observed.failure).toBeUndefined()
  expect(observed.format).toBe('qwerty-backup-v4')
  expect(observed.serializedDuration).toBe(233)
  expect(observed.originalUnchanged).toBe(233)
  // Type metadata must be preserved in the actual exported V4 payload,
  // even though the auditor compares it with JSON-normalized source rows.
  expect(observed.rawTags).toContain('nan')
})


test('real Dexie reviewPolicyShadow exotic nested values round-trip without data loss', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    const initial = await h.db.wordRecords.where('word').equals('backup-fsrs-word').first()
    if (!initial?.id) throw Error('Fixture missing')
    // This representative policy record deliberately includes optional
    // keys, special JS numbers, nonindex array properties and undefined.
    // All are synthetic, without user learning content.
    const shadow = {
      version: 1, mode: 'shadow', appliesTo: 'next-exercise',
      condition: {
        version: 1, purpose: 'probe', source: 'adaptive-policy',
        audio: 'none', meaning: 'visible', phonetic: 'hidden',
        letters: { mode: 'partial', visiblePositions: [0, 2, undefined],
          maskedPositions: [1, 3, NaN] },
        probeDimension: 'orthography',
        optionalFeedback: undefined,
      },
      decision: {
        version: 1, policyVersion: 'synthetic-typeson-v4-regression',
        reasonCodes: ['spelling', undefined, 'learning'],
        conditionVersion: 1, score: Infinity,
      },
    }
    await h.db.wordRecords.update(initial.id, { reviewPolicyShadow: shadow })
    const original = (
      await h.db.wordRecords.toCollection().raw().toArray()
    ).find((row: any) => row.id === initial.id)?.reviewPolicyShadow
    const backup = await h.captureWorkingWorkspaceV4({
      kind: 'account', accountId: 'review-shadow-audit-regression',
    })
    const exported = backup.workspaceData.database.data.data
      .find((group: any) => group.tableName === 'wordRecords')
      .rows.find((row: any) => row.id === initial.id)
    const after = (
      await h.db.wordRecords.toCollection().raw().toArray()
    ).find((row: any) => row.id === initial.id)?.reviewPolicyShadow
    return {
      format: backup.backupFormatVersion,
      owner: backup.metadata.source.accountId,
      source: JSON.stringify(original), post: JSON.stringify(after),
      archiveTypes: exported.$types,
      originalScore: original.decision.score,
      archiveScore: exported.reviewPolicyShadow.decision.score,
    }
  })
  expect(result.format).toBe('qwerty-backup-v4')
  expect(result.owner).toBe('review-shadow-audit-regression')
  expect(result.source).toBe(result.post)
  expect(result.originalScore).toBe(Infinity)
  expect(result.archiveScore).toBe('Infinity')
  expect(Object.keys(result.archiveTypes)).toContain(
    'reviewPolicyShadow.decision.score')
})


/**
 * Broad exporter contract: fixture contains 512 word rows, beyond the index
 * of the first field-specific real-user failure, and 64 rows in each of the
 * other five tables. Every table has nested exotic Typeson inputs.
 *
 * No production data is involved and capture must leave every source row
 * untouched. A single failure in ANY row/table blocks the Chromium Gate.
 */
test('six-table, 832-row, deterministic Typeson matrix exports V4 intact', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.clearAllTables()
    const makeNested = (i: number) => {
      const sparse = [i, undefined, NaN, Infinity, -Infinity]
      // Nonindex array keys are explicitly supported by Dexie Typeson.
      ;(sparse as any).sourceHint = 'word-' + i
      return {
        version: 1,
        flags: { optional: undefined, enabled: true },
        numeric: {
          first: i % 7 === 0 ? NaN : i,
          second: i % 11 === 0 ? Infinity : -Infinity,
          // Dexie ExportImport 4.0.7 does NOT revive -0 losslessly.
          // The dedicated fail-closed regression below must reject -0
          // rather than quietly change stored data during restore.
          signedZero: 0,
        },
        history: sparse,
        eventAt: new Date(Date.UTC(2026, 0, 1 + (i % 28))),
        evidence: ['中文', 'élève', '学习', String(i)],
      }
    }
    const wordRows = Array.from({ length: 512 }, (_, i) => ({
      word: 'matrix-word-' + i,
      dict: 'cet4', chapter: i % 48,
      timeStamp: 1_700_000_000 + i,
      timing: [101, 211, NaN],
      wrongCount: i % 3, mistakes: {},
      typingTelemetry: {
        telemetryVersion: 2, firstKeyLatencyMs: i % 2 ? NaN : Infinity,
        attempts: [{ result: 'wrong', wrongIndex: undefined,
          interKeyIntervalsMs: [3, NaN], durationMs: 1 + i }],
      },
      reviewPolicyShadow: {
        version: 1, mode: 'shadow', appliesTo: 'next-exercise',
        condition: { version: 1, purpose: 'probe', source: 'adaptive-policy',
          audio: 'none', meaning: 'visible', phonetic: 'hidden',
          letters: { mode: 'partial', visiblePositions: [0, NaN, undefined] },
          probeDimension: 'meaning' },
        decision: { version: 1, policyVersion: 'matrix-' + i,
          reasonCodes: ['fresh', undefined, 'review'],
          conditionVersion: 1 },
      },
      fsrsShadow: makeNested(i),
    }))
    await h.db.wordRecords.bulkAdd(wordRows)
    const chapterRows = Array.from({ length: 64 }, (_, i) => ({
      dict: 'cet4', chapter: i, timeStamp: i + 1, time: 100 + i,
      debugEvidence: makeNested(i + 1000),
    }))
    const reviewRows = Array.from({ length: 64 }, (_, i) => ({
      dict: 'cet4', createTime: i + 1, isFinished: i % 2 === 0,
      words: [{ name: 'matrix-' + i, trans: ['解释', undefined] }],
      replayEvidence: makeNested(i + 2000),
    }))
    const stateRows = Array.from({ length: 64 }, (_, i) => ({
      dict: 'cet4', word: 'matrix-' + i,
      nextReviewAt: i + 1, lastReviewedAt: i,
      reviewCount: i, schedulerState: makeNested(i + 3000),
    }))
    const eventRows = Array.from({ length: 64 }, (_, i) => ({
      eventId: 'matrix-event-' + i, sourceRecordId: i + 1,
      occurredAt: 1000 + i, dict: 'cet4', word: 'matrix-' + i,
      metricValues: { attemptCount: i },
      trace: makeNested(i + 4000),
    }))
    const achievementRows = Array.from({ length: 64 }, (_, i) => ({
      achievementId: 'matrix-achievement-' + i,
      unlockedAt: 1000 + i, seenAt: 2000 + i,
      trace: makeNested(i + 5000),
    }))
    for (const [table, rows] of [
      ['chapterRecords', chapterRows],
      ['reviewRecords', reviewRows],
      ['reviewWordStates', stateRows],
      ['achievementEvents', eventRows],
      ['achievementStates', achievementRows],
    ] as const) {
      await h.db.table(table).bulkAdd(rows)
    }
    const before = await Promise.all(h.db.tables
      .filter((t: any) => [
        'wordRecords', 'chapterRecords', 'reviewRecords',
        'reviewWordStates', 'achievementEvents', 'achievementStates',
      ].includes(t.name)).map(async (t: any) => [
        t.name, JSON.stringify(await t.toCollection().raw().toArray()),
      ]))
    const snapshot = await h.captureWorkingWorkspaceV4({
      kind: 'account', accountId: 'matrix-account-only',
    })
    const actual = snapshot.workspaceData.database.data.data
    const counts = Object.fromEntries(actual.map((t: any) => [
      t.tableName, t.rows.length,
    ]))
    const after = await Promise.all(h.db.tables
      .filter((t: any) => [
        'wordRecords', 'chapterRecords', 'reviewRecords',
        'reviewWordStates', 'achievementEvents', 'achievementStates',
      ].includes(t.name)).map(async (t: any) => [
        t.name, JSON.stringify(await t.toCollection().raw().toArray()),
      ]))
    const encodedTypedRows = actual.flatMap((t: any) =>
      t.rows.filter((row: any) => row.$types)).length
    return {
      format: snapshot.backupFormatVersion, counts,
      sourceUnmodified: JSON.stringify(before) === JSON.stringify(after),
      encodedTypedRows,
      firstWord: actual.find((t: any) => t.tableName === 'wordRecords')
        .rows[0]?.word,
      lastWord: actual.find((t: any) => t.tableName === 'wordRecords')
        .rows[511]?.word,
    }
  })
  expect(result.format).toBe('qwerty-backup-v4')
  expect(result.sourceUnmodified).toBe(true)
  expect(result.counts).toMatchObject({
    wordRecords: 512,
    chapterRecords: 64,
    reviewRecords: 64,
    reviewWordStates: 64,
    achievementEvents: 64,
    achievementStates: 64,
  })
  expect(result.encodedTypedRows).toBeGreaterThan(500)
  expect(result.firstWord).toBe('matrix-word-0')
  expect(result.lastWord).toBe('matrix-word-511')
})


test('legacy Dexie 4.0.7 exporter rejects unsupported negative zero without altering learning rows', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.clearAllTables()
    await h.db.wordRecords.add({
      word: 'signed-zero-export-probe', dict: 'cet4',
      chapter: 1, timeStamp: 1_700_000_000,
      fsrsShadow: { numeric: { signedZero: -0 } },
    })
    const before = await h.db.wordRecords.toCollection().raw().first()
    let error = ''
    try {
      await h.captureWorkingWorkspaceV4({
        kind: 'account', accountId: 'signed-zero-probe-account',
      })
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    const after = await h.db.wordRecords.toCollection().raw().first()
    return {
      blocked: /independent roundtrip value mismatch: wordRecords fields fsrsShadow/.test(error),
      sourceNegativeZero: Object.is(before?.fsrsShadow?.numeric?.signedZero, -0),
      persistedNegativeZero: Object.is(after?.fsrsShadow?.numeric?.signedZero, -0),
      count: await h.db.wordRecords.count(),
    }
  })
  expect(result).toEqual({
    blocked: true, sourceNegativeZero: true, persistedNegativeZero: true,
    count: 1,
  })
})

/**
 * Historical ReviewRecord.words can contain repeated references to the same
 * dictionary Word object. Raw IDB structured-clone retains the alias, whereas
 * JSON and Typeson use different serialized representations. A raw six-table
 * fallback must prove lossless roundtrip before accepting such a V4 archive.
 */
test('real Dexie: legacy review row 38 with aliased words passes only a lossless V4 export', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.clearAllTables()
    const rows = Array.from({ length: 64 }, (_, i) => {
      const shared = {
        name: 'historical-review-' + i, trans: ['释义', 'repeat'],
        usphone: '', ukphone: '',
        example: [{ en: 'word example', cn: '中文', start: 0, end: 4 }],
      }
      return {
        dict: 'cet4', index: 0, createTime: i + 1, isFinished: false,
        words: i === 38 ? [shared, shared] : [shared],
      }
    })
    await h.db.reviewRecords.bulkAdd(rows)
    const original = await h.db.reviewRecords.toCollection().raw().toArray()
    const aliased = original[38].words[0] === original[38].words[1]
    const before = JSON.stringify(original)
    const snapshot = await h.captureWorkingWorkspaceV4({
      kind: 'account', accountId: 'historical-alias-synthetic',
    })
    const after = await h.db.reviewRecords.toCollection().raw().toArray()
    const source = { words: [original[38].words[0], original[38].words[0]] }
    const duplicate = { words: [
      { ...original[38].words[0] },
      { ...original[38].words[0] },
    ] }
    return {
      aliased, sourcePreserved: before === JSON.stringify(after),
      aliasPreserved: after[38].words[0] === after[38].words[1],
      malformedAliasRejected: !h.sameLosslessIndexedDbValue(source, duplicate),
      fullExportRows: snapshot.workspaceData.database.data.data
        .find((entry: any) => entry.tableName === 'reviewRecords').rows.length,
      format: snapshot.backupFormatVersion,
    }
  })
  expect(result).toEqual({
    aliased: true, sourcePreserved: true, aliasPreserved: true,
    malformedAliasRejected: true, fullExportRows: 64,
    format: 'qwerty-backup-v4',
  })
})
