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

/** Exercise the actual native multipart HTTP contract, not legacy PUT.
 * All local test requests remain isolated and SHA validated before CAS.
 */
async function installBinaryMock(
  page: Page,
  onCommit: (metadata: any, bytes: Buffer) => Promise<Record<string, unknown>>,
) {
  const staged = new Map<string, Buffer>()
  // The <=512-KiB path now commits in one native binary request.
  // Require the same SHA/CAS evidence as the staged multipart mock.
  await page.route('**/api/sync/v2/binary/direct', async route => {
    const request = route.request()
    expect(request.method()).toBe('POST')
    const headers = request.headers()
    const bytes = request.postDataBuffer()
    expect(bytes).not.toBeNull()
    expect(bytes!.length).toBeGreaterThan(0)
    expect(bytes!.length).toBeLessThanOrEqual(512 * 1024)
    const sha = createHash('sha256').update(bytes!).digest('hex')
    expect(headers['x-qwerty-payload-sha256']).toBe(sha)
    expect(headers['x-qwerty-logical-fingerprint']).toMatch(/^[0-9a-f]{64}$/)
    const baseRevision = Number(headers['x-qwerty-base-revision'])
    expect(Number.isSafeInteger(baseRevision)).toBe(true)
    expect(baseRevision).toBeGreaterThanOrEqual(0)
    const input = {
      baseRevision, logicalFingerprint: headers['x-qwerty-logical-fingerprint'],
      clientFormatVersion: 'qwerty-backup-v4',
      deviceId: headers['x-qwerty-device-id'],
    }
    const result = await onCommit(input, Buffer.from(bytes!))
    await route.fulfill({ json: { ok: true, ...result } })
  })
  await page.route('**/api/sync/v2/parts', async route => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, X-Qwerty-Payload-Sha256, X-Qwerty-Part-Sha256, X-Qwerty-Part-Index, X-Qwerty-Part-Count',
      } })
      return
    }
    expect(request.method()).toBe('POST')
    const headers = request.headers()
    const payloadSha = headers['x-qwerty-payload-sha256']
    const partSha = headers['x-qwerty-part-sha256']
    const index = Number(headers['x-qwerty-part-index'])
    const count = Number(headers['x-qwerty-part-count'])
    const bytes = request.postDataBuffer()
    expect(bytes).not.toBeNull()
    expect(bytes!.length).toBeGreaterThan(0)
    expect(bytes!.length).toBeLessThanOrEqual(512 * 1024)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(count)
    expect(createHash('sha256').update(bytes!).digest('hex')).toBe(partSha)
    staged.set(payloadSha + ':' + count + ':' + index + ':' + partSha, Buffer.from(bytes!))
    await route.fulfill({ json: {
      ok: true, received: true, payloadSha256: payloadSha,
      partSha256: partSha, index,
    } })
  })
  await page.route('**/api/sync/v2/commit', async route => {
    const input = route.request().postDataJSON()
    expect(input.clientFormatVersion).toBe('qwerty-backup-v4')
    expect(input.logicalFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(input.partSha256s).toHaveLength(input.count)
    const bytes = Buffer.concat(input.partSha256s.map((sha: string, index: number) => {
      const value = staged.get(input.payloadSha256 + ':' + input.count +
        ':' + index + ':' + sha)
      expect(value).toBeDefined()
      return value!
    }))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(input.payloadSha256)
    const result = await onCommit(input, bytes)
    await route.fulfill({ json: { ok: true, ...result } })
  })
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
  await installBinaryMock(page, async (input, bytes) => {
    expect(input.baseRevision).toBe(0)
    uploads++
    meta = { ...meta,
      hasData: true, revision: 1, sizeBytes: bytes.byteLength,
      dataSha256: createHash('sha256').update(bytes).digest('hex'),
      payloadSha256: createHash('sha256').update(bytes).digest('hex'),
      logicalFingerprint: input.logicalFingerprint,
      clientFormatVersion: 'qwerty-backup-v4', storageEncoding: 'binary',
    }
    return meta
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
  await installBinaryMock(page, async (input, bytes) => {
    uploads++
    const sha = createHash('sha256').update(bytes).digest('hex')
    return {
      hasData: true, revision: 1, updatedAt: new Date().toISOString(),
      sizeBytes: bytes.length, dataSha256: sha, payloadSha256: sha,
      logicalFingerprint: input.logicalFingerprint,
      deviceId: 's2-ui-test', clientFormatVersion: 'qwerty-backup-v4',
      storageEncoding: 'binary',
    }
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
