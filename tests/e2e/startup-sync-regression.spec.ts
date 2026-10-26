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
