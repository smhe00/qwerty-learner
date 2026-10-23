import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const owner = { kind: 'account' as const, accountId: 's2-block-integration-owner' }

async function seed(page: import('@playwright/test').Page, enabled = true) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as any).__backupHarness?.initializeLegacyWorkspace))).toBe(true)
  await page.evaluate(async ({ identity, optedIn }) => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 's2-block-integration-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: identity.accountId, username: 'block-integration' },
    }))
    await h.initializeLegacyWorkspace(identity)
    const pref = 'qwerty.learn.block-sync.enabled.v1.' + identity.accountId
    if (optedIn) localStorage.setItem(pref, '1')
    else localStorage.removeItem(pref)
    sessionStorage.setItem('qwerty.learn.block-sync.pending.v1', JSON.stringify({
      accountId: identity.accountId,
      at: Date.now(),
      dailyComplete: false,
      milestone: 20,
    }))
  }, { identity: owner, optedIn: enabled })
}

test('real S1 guarded Block handoff: disable exit until V4 upload and CAS complete', async ({ page }) => {
  let uploaded = 0
  let releaseMeta: () => void = () => {}
  const metadataGate = new Promise<void>(resolve => { releaseMeta = resolve })
  await page.route('**/api/sync/v2/meta', async route => {
    await metadataGate
    await route.fulfill({ json: {
      ok: true, hasData: false, revision: 0, updatedAt: null, sizeBytes: 0,
      dataSha256: null, payloadSha256: null, logicalFingerprint: null,
      deviceId: null, clientFormatVersion: null,
    } })
  })
  await page.route('**/api/sync/v2/binary/direct', async route => {
    const request = route.request()
    expect(request.method()).toBe('POST')
    const headers = request.headers()
    expect(headers['x-qwerty-base-revision']).toBe('0')
    expect(headers['x-qwerty-logical-fingerprint']).toMatch(/^[0-9a-f]{64}$/)
    const blob = request.postDataBuffer()!
    expect(blob.length).toBeGreaterThan(0)
    expect(blob.length).toBeLessThanOrEqual(512 * 1024)
    const hash = createHash('sha256').update(blob).digest('hex')
    expect(headers['x-qwerty-payload-sha256']).toBe(hash)
    const snapshot = JSON.parse(gunzipSync(blob).toString('utf8'))
    expect(snapshot.backupFormatVersion).toBe('qwerty-backup-v4')
    expect(snapshot.metadata.source).toEqual(owner)
    expect(snapshot.workspaceData.database.data.tables.map((table: any) => table.name).sort())
      .toEqual(['achievementEvents', 'achievementStates', 'chapterRecords',
        'reviewRecords', 'reviewWordStates', 'wordRecords'])
    uploaded++
    await route.fulfill({ json: {
      ok: true, hasData: true, revision: 1, updatedAt: new Date().toISOString(),
      sizeBytes: blob.length, dataSha256: hash, payloadSha256: hash,
      logicalFingerprint: headers['x-qwerty-logical-fingerprint'], deviceId: 'block-e2e',
      clientFormatVersion: 'qwerty-backup-v4', storageEncoding: 'binary',
    } })
  })
  await seed(page)
  await page.goto('/?s2-sync=run&learn-block=1')
  await expect(page.locator('[data-learn-block-sync]')).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  releaseMeta()
  await expect(page.getByText('同步完成：本地进度已安全上传至云端。')).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('button', { name: '继续学习' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '结束并退出' })).toBeEnabled()
  expect(uploaded).toBe(1)
  await page.getByRole('button', { name: '结束并退出' }).click()
  await expect.poll(() => page.url()).toContain('block-idle=1')
})

test('disabled per-Block toggle prevents a forged interim S2 handoff before requests', async ({ page }) => {
  let requests = 0
  await page.route('**/api/sync/v2**', async route => {
    requests++
    await route.fulfill({ status: 500, json: { error: 'should-not-be-called' } })
  })
  await seed(page, false)
  await page.goto('/?s2-sync=run&learn-block=1')
  await expect(page.getByText(/Block 自动同步上下文失效或当前账号未授权自动同步/)).toBeVisible()
  expect(requests).toBe(0)
})
