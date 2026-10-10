import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'

const owner = { kind: 'account' as const, accountId: 's2-browser-test-account' }
async function ready(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.executePreMountManualSyncV2),
  )).toBe(true)
}
function auth(expiresAt: number) {
  return {
    token: 's2-integration-fake-token', expiresAt,
    user: { userId: owner.accountId, username: 's2-test' },
  }
}

test('guarded S2 V4 Sync pushes once then resolves identical local/cloud as no-op', async ({ page }) => {
  let meta: any = {
    hasData: false, revision: 0, updatedAt: null, sizeBytes: 0,
    dataSha256: null, payloadSha256: null, logicalFingerprint: null,
    deviceId: null, clientFormatVersion: null,
  }
  let uploads = 0
  await page.route('**/api/sync/v2/meta', async route => {
    await route.fulfill({ json: { ok: true, ...meta } })
  })
  await page.route('**/api/sync/v2', async route => {
    if (route.request().method() !== 'PUT') throw Error('unexpected S2 method')
    const input = route.request().postDataJSON()
    expect(input.baseRevision).toBe(0)
    expect(input.clientFormatVersion).toBe('qwerty-backup-v4')
    expect(input.logicalFingerprint).toMatch(/^[0-9a-f]{64}$/)
    uploads++
    const bytes = Buffer.from(input.payloadBase64, 'base64')
    meta = { ...meta,
      hasData: true, revision: 1, sizeBytes: bytes.byteLength,
      dataSha256: createHash('sha256').update(bytes).digest('hex'),
      payloadSha256: createHash('sha256').update(bytes).digest('hex'),
      logicalFingerprint: input.logicalFingerprint,
      clientFormatVersion: 'qwerty-backup-v4',
    }
    await route.fulfill({ json: { ok: true, ...meta } })
  })
  await ready(page)
  const outcome = await page.evaluate(async (identity) => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's2-integration-fake-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: identity.accountId, username: 's2-test' },
    }))
    await h.initializeLegacyWorkspace(identity)
    const boot = await h.mountGuardedWorkspaceApp(() => {})
    try {
      const uploaded = await h.executePreMountManualSyncV2(boot)
      const noop = await h.executePreMountManualSyncV2(boot)
      return {
        uploaded, noop,
        baseline: await h.loadSyncV2Baseline(identity.accountId),
        wordCount: await h.db.wordRecords.count(),
      }
    } finally { boot.release() }
  }, owner)
  expect(outcome.uploaded).toEqual({ status: 'pushed', revision: 1 })
  expect(outcome.noop).toEqual({ status: 'noop', revision: 1 })
  expect(outcome.baseline.baseRevision).toBe(1)
  expect(outcome.wordCount).toBe(1)
  expect(uploads).toBe(1)
})

test('expired isolated S2 credentials fail before any V4 cloud mutation', async ({ page }) => {
  let requests = 0
  await page.route('**/api/sync/v2**', async route => {
    requests++
    await route.abort()
  })
  await ready(page)
  const outcome = await page.evaluate(async identity => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'expired-s2-token',
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
      user: { userId: identity.accountId, username: 's2-test' },
    }))
    await h.initializeLegacyWorkspace(identity)
    const boot = await h.mountGuardedWorkspaceApp(() => {})
    let error = ''
    try { await h.executePreMountManualSyncV2(boot) }
    catch (cause) { error = String(cause) }
    finally { boot.release() }
    return { error, baseline: await h.loadSyncV2Baseline(identity.accountId) }
  }, owner)
  expect(outcome.error).toMatch(/expired/)
  expect(outcome.baseline).toBeNull()
  expect(requests).toBe(0)
})

test('development Sync route leaves mounted app, executes CAS and returns with feedback', async ({ page }) => {
  let uploads = 0
  await page.route('**/api/sync/v2/meta', async route => {
    await route.fulfill({ json: { ok: true,
      hasData: false, revision: 0, updatedAt: null, sizeBytes: 0,
      dataSha256: null, payloadSha256: null, logicalFingerprint: null,
      deviceId: null, clientFormatVersion: null,
    } })
  })
  await page.route('**/api/sync/v2', async route => {
    const input = route.request().postDataJSON()
    uploads++
    const bytes = Buffer.from(input.payloadBase64, 'base64')
    const sha = createHash('sha256').update(bytes).digest('hex')
    await route.fulfill({ json: { ok: true,
      hasData: true, revision: 1, updatedAt: new Date().toISOString(),
      sizeBytes: bytes.length, dataSha256: sha, payloadSha256: sha,
      logicalFingerprint: input.logicalFingerprint,
      deviceId: 's2-ui-test', clientFormatVersion: 'qwerty-backup-v4',
    } })
  })
  await ready(page)
  await page.evaluate(async identity => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's2-integration-fake-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: identity.accountId, username: 's2-test' },
    }))
    await h.initializeLegacyWorkspace(identity)
  }, owner)
  await page.goto('/?s2-sync=run')
  await expect(page.getByText('同步完成：本地进度已安全上传至云端。')).toBeVisible({
    timeout: 25_000,
  })
  expect(uploads).toBe(1)
  // Qwerty's legacy React router can redirect '/' to '/learn/?/...'.
  // Only the S2 one-shot query must disappear; preserve existing routing.
  await expect.poll(() => page.evaluate(() =>
    !window.location.href.includes('s2-sync=run'),
  )).toBe(true)
})
