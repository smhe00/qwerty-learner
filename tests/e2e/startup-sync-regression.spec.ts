import { type Page, type Request, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'

const origin = 'https://t.smhe.cn'
const fixture = '/tests/e2e/startup-sync-regression.html'
const owner = { kind: 'account' as const, accountId: 'local-startup-regression' }

// Approved-origin behavior, but EVERY resource is served from local Vite and
// EVERY API is mocked/aborted. No request reaches etest or a real cloud account.
async function ready(page: Page, baseURL: string) {
  await page.route(origin + '/**', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname.startsWith('/api/')) return route.abort('failed')
    const response = await page.request.get(new URL(u.pathname + u.search, baseURL).href)
    await route.fulfill({ response })
  })
  await navigate(page)
  await page.evaluate(async (identity) => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem(
      'qwerty.cloudAuth.v1',
      JSON.stringify({
        token: 'synthetic-local-only',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: { userId: identity.accountId, username: 'synthetic' },
      }),
    )
    await h.initializeLegacyWorkspace(identity)
  }, owner)
}
async function navigate(page: Page) {
  await page.goto(origin + fixture)
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__startupRegression))).toBe(true)
}
async function expireAfter(page: Page, remaining: number) {
  await page.evaluate(
    async ({ identity, remaining }) => {
      const h = (window as any).__backupHarness,
        b = (window as any).__startupRegression
      const registry = await h.workspaceRegistryPort.read(),
        now = Date.now()
      sessionStorage.setItem(
        b.STARTUP_SYNC_BUDGET_KEY,
        JSON.stringify({
          version: 1,
          accountId: identity.accountId,
          generation: registry.generation,
          attemptId: '00000000-0000-4000-8000-000000000001',
          startedAt: now - 60_000 + remaining,
          deadline: now + remaining,
          reloads: 2,
        }),
      )
    },
    { identity: owner, remaining },
  )
}
async function boot(page: Page) {
  return page.evaluate(async (identity) => {
    history.replaceState(null, '', '/')
    const h = (window as any).__backupHarness
    let mounted = false,
      error = ''
    try {
      const state = await h.mountGuardedWorkspaceApp(() => {
        mounted = true
      })
      state.release()
    } catch (e) {
      error = String(e)
    }
    return {
      mounted,
      error,
      note: sessionStorage.getItem('qwerty.s2.last-sync-result'),
      pending: !!(await h.syncV2PullJournalPort.read()) || !!(await h.m4MergeJournalPort.read()),
      baseline: await h.loadSyncV2Baseline(identity.accountId),
      fingerprint: await h.workspaceFingerprintV4(await h.captureWorkingWorkspaceV4(identity)),
      trace: JSON.parse(sessionStorage.getItem('qwerty.startup-sync-trace.v1') || '[]'),
    }
  }, owner)
}
const emptyMeta = {
  ok: true,
  hasData: false,
  revision: 0,
  updatedAt: null,
  sizeBytes: 0,
  logicalFingerprint: null,
  payloadSha256: null,
  clientFormatVersion: null,
}
function committedMeta(input: Request) {
  const bytes = input.postDataBuffer()!,
    header = input.headers()
  const sha = createHash('sha256').update(bytes).digest('hex')
  expect(header['x-qwerty-payload-sha256']).toBe(sha)
  return {
    ...emptyMeta,
    hasData: true,
    revision: Number(header['x-qwerty-base-revision']) + 1,
    storageEncoding: 'binary',
    sizeBytes: bytes.length,
    payloadSha256: sha,
    logicalFingerprint: header['x-qwerty-logical-fingerprint'],
    clientFormatVersion: 'qwerty-backup-v4',
  }
}

test('slow metadata aborts at inherited budget, then mounts preserved local data with pending notice', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  let reads = 0,
    writes = 0
  await page.route(origin + '/api/**', async (route) => {
    if (route.request().method() !== 'GET') writes++
    if (new URL(route.request().url()).pathname === '/api/sync/v2/meta') {
      reads++
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await route.fulfill({ json: emptyMeta }).catch(() => {})
    } else await route.abort('failed')
  })
  await expireAfter(page, 1000)
  const before = await page.evaluate(async (identity) => {
    const h = (window as any).__backupHarness
    return h.workspaceFingerprintV4(await h.captureWorkingWorkspaceV4(identity))
  }, owner)
  const started = Date.now()
  const result = await boot(page)
  expect(result.mounted).toBe(true)
  expect(result.pending).toBe(false)
  expect(result.fingerprint).toBe(before)
  expect(result.note).toContain('已保存在本机')
  expect(result.trace.at(-1).remainingMs).toBe(0)
  expect(Date.now() - started).toBeLessThan(5000)
  expect(reads).toBe(1)
  expect(writes).toBe(0)
})

test('offline startup retains local data and does not send cloud requests', async ({ page, context, baseURL }) => {
  await ready(page, baseURL!)
  let calls = 0
  await page.route(origin + '/api/**', (route) => {
    calls++
    return route.abort('internetdisconnected')
  })
  await context.setOffline(true)
  const result = await boot(page)
  expect(result.mounted).toBe(true)
  expect(result.pending).toBe(false)
  expect(calls).toBe(0)
})

test('committed upload with lost response mounts pending; reload reconciles without duplicate POST', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  let meta: any = emptyMeta,
    writes = 0
  await page.route(origin + '/api/sync/v2/meta', (route) => route.fulfill({ json: meta }))
  await page.route(origin + '/api/sync/v2/binary/direct', async (route) => {
    writes++
    meta = committedMeta(route.request())
    await route.abort('failed') // Server committed; client never sees ACK.
  })
  const first = await boot(page)
  expect(first.mounted).toBe(true)
  expect(first.baseline).toBeNull()
  expect(first.pending).toBe(false)
  expect(first.note).toContain('已保存在本机')
  expect(writes).toBe(1)
  await navigate(page)
  const second = await boot(page)
  expect(second.mounted).toBe(true)
  expect(second.baseline.baseRevision).toBe(1)
  expect(second.fingerprint).toBe(first.fingerprint)
  expect(second.pending).toBe(false)
  expect(writes).toBe(1)
})

for (const kind of ['pull', 'm4'] as const) {
  test('passive return ticket cannot skip real ' + kind + ' journal with expired budget across reload', async ({ page, baseURL }) => {
    await ready(page, baseURL!)
    const expected = await page.evaluate(
      async ({ identity, kind }) => {
        const h = (window as any).__backupHarness
        const original = await h.captureWorkingWorkspaceV4(identity)
        const candidate = structuredClone(original)
        candidate.workspaceData.navigation.currentChapter = 11
        const fingerprint = await h.workspaceFingerprintV4(candidate)
        const generation = (await h.workspaceRegistryPort.read()).generation
        sessionStorage.setItem(
          'qwerty.account-visit.v1',
          JSON.stringify({
            version: 1,
            phase: 'returning',
            accountId: identity.accountId,
            generation,
            witness: localStorage.getItem('qwerty.s1.workspace-migrated.v1'),
            createdAt: Date.now(),
            target: '/',
          }),
        )
        if (kind === 'pull')
          await h.syncV2PullJournalPort.stage({
            version: 1,
            accountId: identity.accountId,
            registryGeneration: generation,
            revision: 2,
            fingerprint,
            oldBaseline: null,
            snapshot: candidate,
          })
        else
          await h.m4MergeJournalPort.stage({
            version: 1,
            accountId: identity.accountId,
            registryGeneration: generation,
            original,
            candidate,
            originalFingerprint: await h.workspaceFingerprintV4(original),
            candidateFingerprint: fingerprint,
          })
        return fingerprint
      },
      { identity: owner, kind },
    )
    await expireAfter(page, -1)
    await navigate(page)
    let calls = 0
    await page.route(origin + '/api/**', (route) => {
      calls++
      return route.abort('failed')
    })
    const recovering = await boot(page)
    expect(recovering.mounted).toBe(false)
    expect(recovering.error).toContain('recovery completed; reload required')
    expect(await page.evaluate(() => sessionStorage.getItem('qwerty.account-visit.v1'))).toBeNull()
    expect(recovering.pending).toBe(false)
    expect(recovering.fingerprint).toBe(expected)
    await navigate(page)
    const complete = await boot(page)
    expect(complete.mounted).toBe(true)
    expect(complete.fingerprint).toBe(expected)
    expect(complete.pending).toBe(false)
    expect(complete.note).toContain('已保存在本机')
    expect(complete.trace.at(-1).remainingMs).toBe(0)
    expect(complete.trace.filter((x: any) => x.phase === 'reload')).toHaveLength(1)
    expect(calls).toBe(0)
  })
}

test('real M4 followed by same-local six-table union catches cloud up without a Pull journal', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const remote = await page.evaluate(async (identity) => {
    const h = (window as any).__backupHarness,
      r = (window as any).__startupRegression
    const original = await h.captureWorkingWorkspaceV4(identity)
    await h.db.wordRecords.add({
      attemptId: '00000000-0000-4000-8000-000000000007',
      word: 'synthetic-new',
      dict: 'cet4',
      chapter: -1,
      sourceMode: 'learn',
      learnItemKind: 'review',
      timeStamp: 1800000001,
      timing: [100],
      wrongCount: 0,
      mistakes: {},
    })
    const local = await h.mergeAccountV4Snapshots(await h.captureWorkingWorkspaceV4(identity), original)
    await h.restoreWorkingWorkspaceV4(original, identity)
    h.refreshWorkspaceMigrationWitness()
    const originalFingerprint = await h.workspaceFingerprintV4(original)
    await h.executeM4Merge(
      h.m4MergeJournalPort,
      {
        capture: () => h.captureWorkingWorkspaceV4(identity),
        restore: (s: any) => h.restoreWorkingWorkspaceV4(s, identity),
        seal: async () => h.refreshWorkspaceMigrationWitness(),
      },
      {
        accountId: identity.accountId,
        registryGeneration: (await h.workspaceRegistryPort.read()).generation,
        expectedOriginalFingerprint: originalFingerprint,
        candidate: local,
      },
    )
    const payload = await r.payloadV4(original)
    return {
      fingerprint: originalFingerprint,
      localFingerprint: await h.workspaceFingerprintV4(local),
      sha: payload.checksum,
      bytes: Array.from(payload.bytes),
    }
  }, owner)
  const payload = Buffer.from(remote.bytes as number[])
  let meta: any = {
    ...emptyMeta,
    hasData: true,
    revision: 1,
    logicalFingerprint: remote.fingerprint,
    clientFormatVersion: 'qwerty-backup-v4',
    payloadSha256: remote.sha,
    dataSha256: remote.sha,
    sizeBytes: payload.length,
    storageEncoding: 'base64',
  }
  let writes = 0
  await page.route(origin + '/api/sync/v2/meta', (route) => route.fulfill({ json: meta }))
  await page.route(origin + '/api/sync/v2', (route) =>
    route.fulfill({
      json: {
        ...meta,
        payloadEncoding: 'base64',
        payloadBase64: payload.toString('base64'),
      },
    }),
  )
  await page.route(origin + '/api/sync/v2/binary/direct', async (route) => {
    writes++
    meta = committedMeta(route.request())
    await route.fulfill({ json: meta })
  })
  const result = await page.evaluate(async (identity) => {
    const h = (window as any).__backupHarness
    const lease = await h.acquireWorkspaceWriterLease()
    try {
      const result = await h.executePreMountManualSyncV2({ mode: 'isolated', registry: await h.workspaceRegistryPort.read() })
      return {
        result,
        journal: await h.syncV2PullJournalPort.read(),
        baseline: await h.loadSyncV2Baseline(identity.accountId),
        fingerprint: await h.workspaceFingerprintV4(await h.captureWorkingWorkspaceV4(identity)),
      }
    } finally {
      lease.release()
    }
  }, owner)
  expect(result.result).toEqual({ status: 'pushed', revision: 2 })
  expect(result.journal).toBeNull()
  expect(result.baseline.logicalFingerprint).toBe(remote.localFingerprint)
  expect(result.fingerprint).toBe(remote.localFingerprint)
  expect(writes).toBe(1)
})

async function unchangedCloud(page: Page) {
  const cloud = { meta: { ...emptyMeta } as any, payload: Buffer.alloc(0), calls: [] as string[], eventBatches: [] as string[], writes: 0, revoked: false }
  await page.route(origin + '/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    cloud.calls.push(request.method() + ' ' + path)
    if (cloud.revoked) return route.fulfill({ status: 401, json: { ok: false, error: { code: 'session_revoked', message: 'revoked' } } })
    if (path === '/api/sync/v2/meta') return route.fulfill({ json: cloud.meta })
    if (path === '/api/sync/v2/binary/direct') {
      cloud.writes++
      cloud.payload = request.postDataBuffer()!
      cloud.meta = committedMeta(request)
      return route.fulfill({ json: cloud.meta })
    }
    if (path === '/api/sync/events/v2/observed') return route.fulfill({ json: {
      ok: true, observed: [], observedCount: 0, visibleForks: [], visibleGaps: [],
      truncated: false, listingIsAuthoritative: false, convergenceComplete: false,
    } })
    if (path === '/api/sync/v2/binary/manifest') return route.fulfill({ json: {
      ...cloud.meta, payloadEncoding: 'binary', count: 1, chunkBytes: 512 * 1024, partSha256s: [cloud.meta.payloadSha256],
    } })
    if (path === '/api/sync/v2/binary/part') return route.fulfill({ contentType: 'application/octet-stream', body: cloud.payload })
    if (path === '/api/sync/events/v2' && request.method() === 'POST') cloud.eventBatches.push(request.postData()!)
    return route.abort('failed')
  })
  return cloud
}

async function localProof(page: Page) {
  return page.evaluate(identity => (window as any).__startupRegression.startupLocalProofCache.read(identity.accountId), owner)
}
async function clearPerf(page: Page) {
  await page.evaluate(() => sessionStorage.removeItem('qwerty.perf-diagnostics.v1'))
}
async function usedLocalProof(page: Page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('qwerty.perf-diagnostics.v1') || '[]')
    .some((sample: any) => sample.stage === 'startup-local-current' && sample.outcome === 'ok'))
}

for (const width of [390, 1440]) test('unchanged reopened account at width ' + width + ' uses fresh metadata and local proof without exporting or transferring data', async ({ page, baseURL }) => {
  await page.setViewportSize({ width, height: 844 })
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  const first = await boot(page)
  expect(first.mounted).toBe(true); expect(cloud.writes).toBe(1)
  expect(await localProof(page)).not.toBeNull()
  await navigate(page)
  await clearPerf(page)
  cloud.calls.length = 0
  await page.evaluate(() => {
    const h = (window as any).__backupHarness, original = h.db.export.bind(h.db)
    ;(window as any).__exportCalls = 0
    h.db.export = (...args: any[]) => { (window as any).__exportCalls++; return original(...args) }
  })
  const second = await boot(page)
  expect(second.mounted).toBe(true); expect(second.fingerprint).toBe(first.fingerprint)
  expect(await usedLocalProof(page)).toBe(true)
  // boot() independently exports once AFTER mounting to verify conservation.
  expect(await page.evaluate(() => (window as any).__exportCalls)).toBe(1)
  expect(cloud.calls).toEqual(['GET /api/sync/v2/meta', 'GET /api/sync/events/v2/observed'])
  expect(cloud.writes).toBe(1); expect(second.pending).toBe(false)
})

test('native IDB same-count record edit invalidates cached startup and uploads the updated content once', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  await boot(page)
  const before = await localProof(page)
  await navigate(page)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('RecordDB')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('wordRecords', 'readwrite'), store = tx.objectStore('wordRecords')
      const request = store.openCursor()
      request.onsuccess = () => { const cursor = request.result!; cursor.update({ ...cursor.value, wrongCount: 7 }) }
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  }))
  await clearPerf(page)
  const result = await boot(page)
  expect(result.mounted).toBe(true); expect(await usedLocalProof(page)).toBe(false)
  expect(cloud.writes).toBe(2); expect(result.baseline.baseRevision).toBe(2)
  expect((await localProof(page)).localDigest).not.toBe(before.localDigest)
  expect(await page.evaluate(async () => {
    const rows = await (window as any).__backupHarness.db.wordRecords.toCollection().raw().toArray()
    return { count: rows.length, wrongCount: rows[0].wrongCount }
  })).toEqual({ count: 1, wrongCount: 7 })
})

for (const kind of ['settings', 'daily-session']) test(kind + ' storage changes cannot hide behind unchanged record counts', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  await boot(page)
  const before = await localProof(page)
  await page.evaluate(kind => {
    if (kind === 'settings') localStorage.setItem('typingTransVisible', 'false')
    else localStorage.setItem('qwerty.learn.dailySession.v1.cet4', JSON.stringify({
      version: 1, sessionId: 'cet4:2026-10-29:1', dict: 'cet4', dateKey: '2026-10-29',
      startedAt: 100, status: 'active', dailyNewTarget: 32, plannedNewWords: 4,
      plannedReviewWords: ['backup-fsrs-word'], carryOverAcquisitionWords: [],
      accumulatedActiveSeconds: 190, completedBlockIds: ['block-1'], blockCount: 1,
    }))
  }, kind)
  await navigate(page)
  await clearPerf(page)
  const result = await boot(page)
  expect(result.mounted).toBe(true); expect(await usedLocalProof(page)).toBe(false)
  expect(cloud.writes).toBe(2); expect((await localProof(page)).localDigest).not.toBe(before.localDigest)
})

test('damaged proof falls back to full comparison without uploading identical records', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  await boot(page)
  await page.evaluate(async identity => {
    const cache = (window as any).__startupRegression.startupLocalProofCache
    const saved = await cache.read(identity.accountId)
    await cache.save(identity.accountId, { ...saved, checksum: '0'.repeat(64) })
  }, owner)
  await navigate(page); await clearPerf(page)
  expect((await boot(page)).mounted).toBe(true)
  expect(await usedLocalProof(page)).toBe(false); expect(cloud.writes).toBe(1)
  expect((await localProof(page)).checksum).not.toBe('0'.repeat(64))
})

test('new remote revision downloads through the existing journal and reopens with all data retained', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  await boot(page)
  const remote = await page.evaluate(async identity => {
    const h = (window as any).__backupHarness, r = (window as any).__startupRegression
    const snapshot = await h.captureWorkingWorkspaceV4(identity)
    snapshot.workspaceData.navigation.currentChapter = 11
    const payload = await r.payloadV4(snapshot)
    return { fingerprint: await h.workspaceFingerprintV4(snapshot), bytes: Array.from(payload.bytes), sha: payload.checksum }
  }, owner)
  cloud.payload = Buffer.from(remote.bytes)
  cloud.meta = { ...cloud.meta, revision: 2, logicalFingerprint: remote.fingerprint,
    payloadSha256: remote.sha, sizeBytes: cloud.payload.length }
  await navigate(page); await clearPerf(page)
  cloud.calls.length = 0
  const staged = await boot(page)
  expect(staged.mounted).toBe(false); expect(staged.error).toContain('S2 Pull staged')
  expect(staged.pending).toBe(true); expect(await usedLocalProof(page)).toBe(false)
  expect(cloud.calls).toEqual(['GET /api/sync/v2/meta', 'GET /api/sync/v2/binary/manifest',
    'GET /api/sync/v2/binary/part', 'GET /api/sync/v2/meta'])
  await navigate(page)
  expect((await boot(page)).error).toContain('S2 Pull recovery completed')
  await navigate(page)
  const resumed = await boot(page)
  expect(resumed.mounted).toBe(true); expect(resumed.pending).toBe(false)
  expect(resumed.fingerprint).toBe(remote.fingerprint); expect(resumed.baseline.baseRevision).toBe(2)
  expect(cloud.writes).toBe(1)
})

test('fresh session rejection cannot be masked by a cached local proof', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  const first = await boot(page)
  await navigate(page); await clearPerf(page)
  cloud.revoked = true
  const rejected = await boot(page)
  expect(await usedLocalProof(page)).toBe(false)
  expect(await page.evaluate(() => sessionStorage.getItem('qwerty.s2.startup-check.v1'))).toBe('pending')
  expect(rejected.note).toContain('尚未确认')
  expect(rejected.fingerprint).toBe(first.fingerprint); expect(cloud.writes).toBe(1)
})

test('completed manual sync refreshes local proof so the next opening avoids a full export', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  const manual = await page.evaluate(async () => {
    const h = (window as any).__backupHarness, lease = await h.acquireWorkspaceWriterLease()
    try {
      return await h.executePreMountManualSyncV2({ mode: 'isolated', registry: await h.workspaceRegistryPort.read() })
    } finally { lease.release() }
  })
  expect(manual.status).toBe('pushed'); expect(await localProof(page)).not.toBeNull()
  await navigate(page); await clearPerf(page)
  expect((await boot(page)).mounted).toBe(true)
  expect(await usedLocalProof(page)).toBe(true); expect(cloud.writes).toBe(1)
})

test('current V4 proof retains and retries the identical outstanding immutable-event batch', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  const cloud = await unchangedCloud(page)
  await page.evaluate(async () => {
    await (window as any).__backupHarness.db.wordRecords.add({
      attemptId: '00000000-0000-4000-8000-000000000099', word: 'pending', dict: 'cet4', chapter: -1,
      sourceMode: 'learn', learnItemKind: 'review', timeStamp: 1800000000, timing: [], wrongCount: 0, mistakes: {},
    })
  })
  const first = await boot(page)
  expect(first.mounted).toBe(true); expect(await localProof(page)).not.toBeNull()
  expect(cloud.calls).toContain('POST /api/sync/events/v2')
  expect(cloud.writes).toBe(1)
  cloud.calls.length = 0
  await navigate(page); await clearPerf(page)
  const second = await boot(page)
  expect(second.mounted).toBe(true); expect(await usedLocalProof(page)).toBe(true)
  expect(second.fingerprint).toBe(first.fingerprint)
  expect(cloud.calls).toContain('POST /api/sync/events/v2')
  expect(cloud.eventBatches).toHaveLength(2)
  expect(cloud.eventBatches[1]).toBe(cloud.eventBatches[0])
  expect(cloud.writes).toBe(1)
})


test('historical shared review objects survive IDB reload and reuse only an exact local proof', async ({ page, baseURL }) => {
  await ready(page, baseURL!)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const shared = { name: 'historical-shared', trans: ['中文🙂'], 'audit.date': new Date('2026-10-24T00:00:00Z') }
    await h.db.reviewRecords.add({ dict: 'cet4', index: 0, createTime: 1_700_000_000,
      isFinished: false, words: [shared, shared], sessionKind: 'review' })
  })
  const cloud = await unchangedCloud(page)
  const first = await boot(page)
  expect(first.mounted).toBe(true)
  expect(await localProof(page)).not.toBeNull()
  await navigate(page)
  await clearPerf(page)
  const second = await boot(page)
  expect(second.mounted).toBe(true)
  expect(second.fingerprint).toBe(first.fingerprint)
  expect(await usedLocalProof(page)).toBe(true)
  expect(cloud.writes).toBe(1)
  expect(await page.evaluate(async () => {
    const rows = await (window as any).__backupHarness.db.reviewRecords.toCollection().raw().toArray()
    const row = rows.find((r: any) => r.words?.[0]?.name === 'historical-shared')
    return row.words[0] === row.words[1] && row.words[0]['audit.date'] instanceof Date
  })).toBe(true)
  // Same number of rows, UUIDs and words; changing only alias topology must
  // invalidate evidence and run the complete audit (not silently reuse it).
  await page.evaluate(async () => {
    const db = (window as any).__backupHarness.db
    const rows = await db.reviewRecords.toCollection().raw().toArray()
    const row = rows.find((r: any) => r.words?.[0]?.name === 'historical-shared')
    row.words[1] = structuredClone(row.words[0])
    await db.reviewRecords.put(row)
  })
  await clearPerf(page)
  const changed = await boot(page)
  expect(changed.mounted).toBe(true)
  expect(await usedLocalProof(page)).toBe(false)
})
