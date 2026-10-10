import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'

const owner = { kind: 'account' as const, accountId: 'p3b-immutable-account' }

async function seed(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async identity => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'p3b-fake-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: identity.accountId, username: 'p3b-test' },
    }))
    await h.initializeLegacyWorkspace(identity)
  }, owner)
}

async function remoteFixture(page: Page, version: 'v3' | 'v4') {
  const exported = await page.evaluate(async ({ id, format }) => {
    const h = (window as any).__backupHarness
    if (format === 'v3') {
      const legacy = JSON.parse(await h.exportBackupJson())
      legacy.learningState.currentChapter = 17
      return { data: JSON.stringify(legacy), hash: null }
    }
    const snapshot = await h.captureWorkingWorkspaceV4({ kind: 'account', accountId: id })
    snapshot.workspaceData.navigation.currentChapter = 17
    return { data: JSON.stringify(snapshot), hash: await h.workspaceFingerprintV4(snapshot) }
  }, { id: owner.accountId, format: version })
  const raw = gzipSync(Buffer.from(exported.data, 'utf8'))
  const sha = createHash('sha256').update(raw).digest('hex')
  const meta = {
    hasData: true, revision: 3, updatedAt: '2026-10-10T00:00:00Z',
    sizeBytes: raw.length, dataSha256: sha, payloadSha256: sha,
    logicalFingerprint: exported.hash, clientFormatVersion: version === 'v3'
      ? 'qwerty-backup-v3' : 'qwerty-backup-v4',
    deviceId: 'p3b-remote',
  }
  return { meta, snapshot: { ...meta, payloadBase64: raw.toString('base64'),
    payloadEncoding: 'base64' } }
}

async function archiveBoth(page: Page) {
  const execute = page.getByText('⑤ 我已备份两端数据，继续执行选定方向')
  await expect(execute).toBeDisabled()
  const localDownload = page.waitForEvent('download')
  await page.getByText('① 下载本地完整 Backup V4（.gz）').click()
  const local = await localDownload
  expect(local.suggestedFilename()).toContain('LOCAL-V4')
  const cloudDownload = page.waitForEvent('download')
  await page.getByText('② 下载云端原始 Backup', { exact: false }).click()
  const cloud = await cloudDownload
  expect(cloud.suggestedFilename()).toContain('CLOUD-qwerty-backup')
  await page.getByLabel('已确认本地备份保存成功').check()
  await page.getByLabel('已确认云端原始备份保存成功').check()
  await page.getByLabel('确认不可变账户 ID').fill(owner.accountId)
}

test('P3b V4 divergence stays read-only until both backups, ID and explicit consent', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page, 'v4')
  let meta = fixture.meta
  let uploads = 0
  await page.route('**/api/sync/v2/meta', r => r.fulfill({ json: { ok: true, ...meta } }))
  await page.route('**/api/sync/v2', r => r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    uploads++
    const input = r.request().postDataJSON()
    expect(input.accountConfirmation).toBe(owner.accountId)
    expect(input.expectedRemoteSha256).toBe(fixture.meta.payloadSha256)
    expect(input.expectedRemoteLogicalFingerprint).toBe(fixture.meta.logicalFingerprint)
    expect(input.recoveryMode).toBe('replace-v4')
    expect(input.baseRevision).toBe(3)
    const zipped = Buffer.from(input.payloadBase64, 'base64')
    const hash = createHash('sha256').update(zipped).digest('hex')
    meta = { ...meta, revision: 4, logicalFingerprint: input.logicalFingerprint,
      payloadSha256: hash, dataSha256: hash, sizeBytes: zipped.length }
    await r.fulfill({ json: { ok: true, ...meta } })
  })
  await page.goto('/?s2-recovery=manage')
  await expect(page.getByText('云同步高级恢复（S2）')).toBeVisible()
  const action = page.getByText('⑤ 我已备份两端数据，继续执行选定方向')
  await expect(action).toBeDisabled()
  await archiveBoth(page)
  await expect(action).toBeDisabled()
  await page.locator('select').selectOption('keep-local')
  await expect(action).toBeEnabled()
  page.once('dialog', async dialog => { await dialog.dismiss() })
  await action.click()
  await expect(page.getByText('用户取消；未更改数据。')).toBeVisible()
  expect(uploads).toBe(0)
  page.once('dialog', async dialog => { await dialog.accept() })
  await action.click()
  await expect(page.getByText('已按确认保留本机学习记录，云端现为 V4 revision 4。')).toBeVisible({
    timeout: 20_000,
  })
  expect(uploads).toBe(1)
})

test('P3b V3 migration keeps old cloud backup and uses separate account-pinned CAS', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page, 'v3')
  let migrated: any = null
  await page.route('**/api/sync/v2/meta', r => r.fulfill({ json: { ok: true, ...fixture.meta } }))
  await page.route('**/api/sync/v2', r => r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    migrated = r.request().postDataJSON()
    const bytes = Buffer.from(migrated.payloadBase64, 'base64')
    const sha = createHash('sha256').update(bytes).digest('hex')
    await r.fulfill({ json: { ok: true, ...fixture.meta,
      revision: 4, clientFormatVersion: 'qwerty-backup-v4',
      logicalFingerprint: migrated.logicalFingerprint, dataSha256: sha,
      payloadSha256: sha, sizeBytes: bytes.length } })
  })
  await page.goto('/?s2-recovery=manage')
  await archiveBoth(page)
  await page.locator('select').selectOption('keep-local')
  page.once('dialog', d => d.accept())
  await page.getByText('⑤ 我已备份两端数据，继续执行选定方向').click()
  await expect(page.getByText('已按确认保留本机学习记录，云端现为 V4 revision 4。')).toBeVisible({
    timeout: 20_000,
  })
  expect(migrated.recoveryMode).toBe('migrate-v3')
  expect(migrated.expectedRemoteSha256).toBe(fixture.meta.payloadSha256)
  expect(migrated.expectedRemoteFormat).toBe('qwerty-backup-v3')
})

test('P3b stale cloud revision after backup cancels before any recovery CAS or restore', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page, 'v4')
  let metaCalls = 0
  let recoveryCalls = 0
  await page.route('**/api/sync/v2/meta', async r => {
    metaCalls++
    const meta = metaCalls > 2 ? { ...fixture.meta, revision: 4 } : fixture.meta
    await r.fulfill({ json: { ok: true, ...meta } })
  })
  await page.route('**/api/sync/v2', r => r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    recoveryCalls++
    await r.abort()
  })
  await page.goto('/?s2-recovery=manage')
  await archiveBoth(page)
  await page.locator('select').selectOption('keep-local')
  page.once('dialog', d => d.accept())
  await page.getByText('⑤ 我已备份两端数据，继续执行选定方向').click()
  await expect(page.getByText(/Cloud revision changed after backup/)).toBeVisible()
  expect(recoveryCalls).toBe(0)
  const recordCount = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return h?.db ? h.db.wordRecords.count() : 'not-mounted'
  })
  // A pre-mount recovery screen does not mount the app's writer tree.
  expect(recordCount).toBe('not-mounted')
})

test('P3b keep-cloud V4 restores only after pinned verification and durable journal', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page, 'v4')
  let recoveryWrites = 0
  await page.route('**/api/sync/v2/meta', r => r.fulfill({ json: { ok: true, ...fixture.meta } }))
  await page.route('**/api/sync/v2', r => r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    recoveryWrites++
    await r.abort()
  })
  await page.goto('/?s2-recovery=manage')
  await archiveBoth(page)
  await page.locator('select').selectOption('keep-cloud')
  page.once('dialog', d => d.accept())
  await page.getByText('⑤ 我已备份两端数据，继续执行选定方向').click()
  await page.waitForTimeout(3000)
  console.log('P3b V4 outcome: ' + (await page.locator('body').innerText()).slice(0, 1400) +
    ' URL=' + page.url())
  await expect(page.getByText('已完成云端学习数据安全恢复。')).toBeVisible({
    timeout: 8000,
  })
  expect(recoveryWrites).toBe(0)
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.inspect),
  )).toBe(true)
  const persisted = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      chapter: (await h.inspect()).currentChapter,
      revision: (await h.loadSyncV2Baseline('p3b-immutable-account')).baseRevision,
      pending: await h.syncV2PullJournalPort.read(),
    }
  })
  expect(persisted).toEqual({ chapter: 17, revision: 3, pending: null })
})

test('P3b keep-cloud V3 explicitly migrates to V4 then restores with CAS', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page, 'v3')
  let current = fixture.meta
  let migrated: any = null
  await page.route('**/api/sync/v2/meta', r => r.fulfill({ json: { ok: true, ...current } }))
  await page.route('**/api/sync/v2', r => r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    migrated = r.request().postDataJSON()
    const bytes = Buffer.from(migrated.payloadBase64, 'base64')
    const sha = createHash('sha256').update(bytes).digest('hex')
    current = {
      ...current, revision: 4, sizeBytes: bytes.length,
      clientFormatVersion: 'qwerty-backup-v4',
      logicalFingerprint: migrated.logicalFingerprint,
      payloadSha256: sha, dataSha256: sha,
    }
    await r.fulfill({ json: { ok: true, ...current } })
  })
  await page.goto('/?s2-recovery=manage')
  await archiveBoth(page)
  await page.locator('select').selectOption('keep-cloud')
  page.once('dialog', d => d.accept())
  await page.getByText('⑤ 我已备份两端数据，继续执行选定方向').click()
  await page.waitForTimeout(3000)
  console.log('P3b V3 outcome: ' + (await page.locator('body').innerText()).slice(0, 1400) +
    ' URL=' + page.url())
  await expect(page.getByText('已完成云端学习数据安全恢复。')).toBeVisible({
    timeout: 8000,
  })
  expect(migrated.recoveryMode).toBe('migrate-v3')
  expect(migrated.expectedRemoteSha256).toBe(fixture.meta.payloadSha256)
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.inspect),
  )).toBe(true)
  const persisted = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      chapter: (await h.inspect()).currentChapter,
      revision: (await h.loadSyncV2Baseline('p3b-immutable-account')).baseRevision,
      pending: await h.syncV2PullJournalPort.read(),
    }
  })
  expect(persisted).toEqual({ chapter: 17, revision: 4, pending: null })
})
