/**
 * P4b-2: separate Chromium browser profiles, sharing only a deterministic
 * CAS API server. Each context has its OWN IndexedDB/localStorage/Web Locks;
 * no test imports another device's Vault or RecordDB.
 *
 * This is NOT EdgeOne Maker/Blob live verification (P4b-3).
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page, Route } from '@playwright/test'

const OWNER = { kind: 'account' as const, accountId: 'p4b-same-immutable-account' }

class SharedMockCloud {
  private current: any = null
  successfulWrites = 0
  refusedCAS = 0
  readonly byRevision = new Map<number, any>()

  snapshot() {
    return this.current
      ? JSON.parse(gunzipSync(Buffer.from(this.current.payloadBase64, 'base64')).toString('utf8'))
      : null
  }

  meta() {
    if (!this.current) return {
      hasData: false, revision: 0, updatedAt: null, sizeBytes: 0,
      dataSha256: null, payloadSha256: null, logicalFingerprint: null,
      deviceId: null, clientFormatVersion: null,
    }
    const { payloadBase64: _payloadBase64, payloadEncoding: _payloadEncoding, ...meta } = this.current
    return meta
  }

  async route(r: Route) {
    const request = r.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    if (request.method() === 'GET') {
      if (pathname.endsWith('/meta')) {
        await r.fulfill({ json: { ok: true, ...this.meta() } })
      } else {
        await r.fulfill({ json: { ok: true, ...this.meta(),
          payloadEncoding: 'base64', payloadBase64: this.current?.payloadBase64 ?? null } })
      }
      return
    }
    if (request.method() !== 'PUT' || pathname.endsWith('/recovery')) {
      throw new Error('Test cloud rejected unexpected API method')
    }
    const body = request.postDataJSON()
    const currentRevision = this.current?.revision ?? 0
    // The in-memory state assignment is our linearizable CAS point.
    if (body.baseRevision !== currentRevision) {
      this.refusedCAS++
      await r.fulfill({ status: 409, json: {
        ok: false, error: 'sync_conflict', message: 'revision conflict',
        details: { current: this.meta() },
      } })
      return
    }
    const gzip = Buffer.from(body.payloadBase64, 'base64')
    const sha = createHash('sha256').update(gzip).digest('hex')
    this.current = {
      hasData: true, revision: currentRevision + 1,
      updatedAt: '2026-10-10T00:00:00Z',
      sizeBytes: gzip.length, dataSha256: sha, payloadSha256: sha,
      logicalFingerprint: body.logicalFingerprint,
      clientFormatVersion: 'qwerty-backup-v4',
      deviceId: 'simulated-device', payloadBase64: body.payloadBase64,
      payloadEncoding: 'base64',
    }
    this.successfulWrites++
    this.byRevision.set(this.current.revision, { ...this.current })
    await r.fulfill({ json: { ok: true, ...this.meta() } })
  }

  async connect(context: BrowserContext) {
    await context.route(/\/api\/sync\/v2(?:\/|$|\?)/, r => this.route(r))
  }
}

async function makeDevice(
  browser: Browser, cloud: SharedMockCloud, label: string, seeded: boolean,
) {
  const context = await browser.newContext({ acceptDownloads: true, baseURL: 'http://127.0.0.1:4178', serviceWorkers: 'block' })
  await cloud.connect(context)
  const page = await context.newPage()
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.initializeLegacyWorkspace),
  )).toBe(true)
  await page.evaluate(async ({ owner, token, seed }) => {
    const h = (window as any).__backupHarness
    if (seed) await h.seed()
    else await h.clearAllTables()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token, expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: owner.accountId, username: 'p4b-owner' },
    }))
    await h.initializeLegacyWorkspace(owner)
  }, { owner: OWNER, token: 'p4b-' + label, seed: seeded })
  return { context, page, label }
}

async function sync(page: Page, expected: string) {
  await page.goto('/?s2-sync=run')
  await expect(page.getByText(expected)).toBeVisible({ timeout: 25_000 })
}

async function inspect(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.loadSyncV2Baseline),
  )).toBe(true)
  return page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      baseline: await h.loadSyncV2Baseline('p4b-same-immutable-account'),
      count: await h.db.wordRecords.count(),
      fingerprint: await h.workspaceFingerprintV4(
        await h.captureWorkingWorkspaceV4({
          kind: 'account', accountId: 'p4b-same-immutable-account',
        }),
      ),
      workspaceData: (await h.captureWorkingWorkspaceV4({
        kind: 'account', accountId: 'p4b-same-immutable-account',
      })).workspaceData,
      preservedLearnWord: Boolean(await h.db.wordRecords.where('word')
        .equals('backup-fsrs-word').first()),
      preservedFsrs: Boolean(await h.db.reviewWordStates.where('[dict+word]')
        .equals(['cet4', 'backup-fsrs-word']).first()),
    }
  })
}

async function addWord(page: Page, label: string) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.db),
  )).toBe(true)
  await page.evaluate(async word => {
    const h = (window as any).__backupHarness
    await h.db.wordRecords.add({
      dict: 'cet4', chapter: -1, word,
      timeStamp: Date.now(), timing: [100], wrongCount: 0, mistakes: {},
    })
  }, 'p4b-device-' + label)
}

test('P4b two independent profiles roundtrip, then detect divergent edits without overwriting', async ({ browser }) => {
  const server = new SharedMockCloud()
  const A = await makeDevice(browser, server, 'A', true)
  const B = await makeDevice(browser, server, 'B', false)
  try {
    await sync(A.page, '同步完成：本地进度已安全上传至云端。')
    expect(server.successfulWrites).toBe(1)
    await sync(B.page, '已完成云端学习数据安全恢复。')
    const b1 = await inspect(B.page)
    expect(b1.baseline.baseRevision).toBe(1)
    expect(b1.count).toBe(1)
    expect(b1.preservedLearnWord).toBe(true)
    expect(b1.preservedFsrs).toBe(true)
    // A newly hydrated Learn runtime may create a DailySession. A change
    // in its canonical snapshot after app mount is separately tracked; it
    // cannot substitute for a missing/dropped durable learning row.
    if (b1.fingerprint !== server.meta().logicalFingerprint) {
      const original = server.snapshot().workspaceData
      const restored = b1.workspaceData
      console.log('P4b post-hydration drift sections: ' + JSON.stringify({
        navigation: { original: original.navigation, restored: restored.navigation },
        settings: { original: original.settings, restored: restored.settings },
        dailySessions: {
          original: original.learnRuntime.dailySessions,
          restored: restored.learnRuntime.dailySessions,
        },
        dbRows: original.database.data.data.map((g: any) => ({
          name: g.tableName, before: g.rows.length,
          after: restored.database.data.data.find((x: any) =>
            x.tableName === g.tableName)?.rows.length,
        })),
      }))
    }

    await addWord(A.page, 'A')
    await addWord(B.page, 'B')
    await sync(B.page, '同步完成：本地进度已安全上传至云端。')
    expect(server.successfulWrites).toBe(2)
    await sync(A.page, '同步冲突：本地和云端均有变化，未覆盖任何一方。')
    const a = await inspect(A.page)
    expect(a.count).toBe(2)
    expect(a.baseline.baseRevision).toBe(1)
    const b = await inspect(B.page)
    expect(b.count).toBe(2)
    expect(b.baseline.baseRevision).toBe(2)
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(server.meta().logicalFingerprint).toBe(b.baseline.logicalFingerprint)
  } finally {
    await Promise.all([A.context.close(), B.context.close()])
  }
})

test('P4b three independent profiles competing CAS admit one winner and retain all local changes', async ({ browser }) => {
  const server = new SharedMockCloud()
  const A = await makeDevice(browser, server, 'A', true)
  const B = await makeDevice(browser, server, 'B', false)
  const C = await makeDevice(browser, server, 'C', false)
  try {
    await sync(A.page, '同步完成：本地进度已安全上传至云端。')
    await sync(B.page, '已完成云端学习数据安全恢复。')
    await sync(C.page, '已完成云端学习数据安全恢复。')
    const baseline = await Promise.all([inspect(A.page), inspect(B.page), inspect(C.page)])
    expect(baseline.map(s => s.baseline.baseRevision)).toEqual([1, 1, 1])
    expect(baseline.map(s => s.count)).toEqual([1, 1, 1])
    expect(baseline.map(s => s.preservedFsrs)).toEqual([true, true, true])
    await Promise.all([addWord(A.page, 'A'), addWord(B.page, 'B'), addWord(C.page, 'C')])
    await Promise.all([A.page.goto('/?s2-sync=run'),
      B.page.goto('/?s2-sync=run'), C.page.goto('/?s2-sync=run')])
    await Promise.all([A.page, B.page, C.page].map(page =>
      expect.poll(async () => page.evaluate(() =>
        !window.location.href.includes('s2-sync=run'))).toBe(true)))
    expect(server.successfulWrites).toBe(2)
    // Concurrent stale clients may be blocked by preflight metadata (no
    // PUT) or rejected by the server CAS itself. Both are safe outcomes.
    expect(server.refusedCAS).toBeLessThanOrEqual(2)
    expect(server.byRevision.size).toBe(2)
    const states = await Promise.all([inspect(A.page), inspect(B.page), inspect(C.page)])
    expect(states.map(s => s.count)).toEqual([2, 2, 2])
    expect(states.filter(s => s.baseline.baseRevision === 2)).toHaveLength(1)
    expect(states.filter(s => s.baseline.baseRevision === 1)).toHaveLength(2)
    expect(states.find(s => s.baseline.baseRevision === 2)?.baseline.logicalFingerprint)
      .toBe(server.meta().logicalFingerprint)
  } finally {
    await Promise.all([A.context.close(), B.context.close(), C.context.close()])
  }
})
