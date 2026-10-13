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

async function remoteFixture(page: Page) {
  const exported = await page.evaluate(async id => {
    const h = (window as any).__backupHarness
    const snapshot = await h.captureWorkingWorkspaceV4({ kind: 'account', accountId: id })
    snapshot.workspaceData.navigation.currentChapter = 17
    return { data: JSON.stringify(snapshot), hash: await h.workspaceFingerprintV4(snapshot) }
  }, owner.accountId)
  const raw = gzipSync(Buffer.from(exported.data, 'utf8'))
  const sha = createHash('sha256').update(raw).digest('hex')
  const meta = {
    hasData: true, revision: 3, updatedAt: '2026-10-10T00:00:00Z',
    sizeBytes: raw.length, dataSha256: sha, payloadSha256: sha,
    logicalFingerprint: exported.hash, clientFormatVersion: 'qwerty-backup-v4',
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

test('P3b visibly identifies missing backup downloads before recovery can start', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page)
  let writes = 0
  await page.route('**/api/sync/v2/meta', r => r.fulfill({ json: { ok: true, ...fixture.meta } }))
  await page.route('**/api/sync/v2', r => r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    writes++
    await r.fulfill({ status: 500, json: { error: 'unexpected_recovery_write' } })
  })
  await page.goto('/?s2-recovery=manage')
  const apply = page.getByRole('button', { name: '⑤ 我已备份两端数据，继续执行选定方向' })
  await expect(page.getByText('点击①从本页面下载本地 V4')).toBeVisible()
  await expect(page.getByText('点击②从本页面下载云端原始备份')).toBeVisible()
  // Checked boxes, choice and correct ID are still NOT proof of the two
  // downloads from this exact pinned cloud revision.
  await page.getByLabel('已确认本地备份保存成功').check()
  await page.getByLabel('已确认云端原始备份保存成功').check()
  await page.locator('select').selectOption('keep-local')
  await page.getByLabel('确认不可变账户 ID').fill(owner.accountId)
  await expect(apply).toBeDisabled()
  await expect(page.getByText('点击①从本页面下载本地 V4')).toBeVisible()
  await expect(page.getByText('点击②从本页面下载云端原始备份')).toBeVisible()

  const localDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '① 下载本地完整 Backup V4（.gz）' }).click()
  await localDownload
  await expect(page.getByText('点击①从本页面下载本地 V4')).toHaveCount(0)
  await expect(page.getByText('点击②从本页面下载云端原始备份')).toBeVisible()
  await expect(apply).toBeDisabled()
  const cloudDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /② 下载云端原始 Backup V3/ }).click()
  await cloudDownload
  await page.getByLabel('已确认本地备份保存成功').check()
  await page.getByLabel('已确认云端原始备份保存成功').check()
  await expect(page.getByText('所有迁移前置条件已满足。⑤ 已解锁；点击后仍会再次显示最终覆盖确认。')).toBeVisible()
  await expect(apply).toBeEnabled()
  expect(writes).toBe(0)
})

test('P3b V4 divergence stays read-only until both backups, ID and explicit consent', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page)
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


test('P3b stale deployed server 403 explains release mismatch and disallows retry', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page)
  let writes = 0
  await page.route('**/api/sync/v2/meta', r => r.fulfill({ json: { ok: true, ...fixture.meta } }))
  await page.route('**/api/sync/v2', r => r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    writes++
    await r.fulfill({ status: 403, json: {
      ok: false, error: 's2_write_not_enabled',
      message: 'V4 write allowlist not configured',
    } })
  })
  await page.goto('/?s2-recovery=manage')
  await archiveBoth(page)
  await page.locator('select').selectOption('keep-local')
  const action = page.getByRole('button', { name: '⑤ 我已备份两端数据，继续执行选定方向' })
  await expect(action).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await action.click()
  await expect(page.getByText(/已停止覆盖：/)).toBeVisible()
  await expect(page.getByText(/生产环境可能尚未部署全账号 V4 版本/)).toBeVisible()
  await expect(page.getByText(/操作已停止；必须重新读取云端最新 revision/)).toBeVisible()
  await expect(action).toBeDisabled()
  await expect.poll(() => writes).toBe(1)
  // Typing in a different account / clicking acknowledgements must not
  // re-enable stale pinned writes after any attempted request.
  await page.getByLabel('确认不可变账户 ID').fill(owner.accountId)
  await page.getByLabel('已确认本地备份保存成功').uncheck()
  await page.getByLabel('已确认本地备份保存成功').check()
  await expect(action).toBeDisabled()
  expect(writes).toBe(1)
  await page.getByRole('button', { name: '重新读取云端状态（只读，不执行覆盖）' }).click()
  await expect(page.getByText('点击①从本页面下载本地 V4')).toBeVisible()
  await expect(page.getByText('点击②从本页面下载云端原始备份')).toBeVisible()
  await expect(action).toBeDisabled()
  expect(writes).toBe(1)
})

test('P3b HTTP 500 with unchanged remote rechecks meta read-only without retry', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page)
  let reads = 0
  let writes = 0
  await page.route('**/api/sync/v2/meta', async r => {
    reads++
    await r.fulfill({ json: { ok: true, ...fixture.meta } })
  })
  await page.route('**/api/sync/v2', r =>
    r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    writes++
    await r.fulfill({ status: 500, json: {
      ok: false, error: 'internal_error', message: 'Internal server error',
    } })
  })
  await page.goto('/?s2-recovery=manage')
  await archiveBoth(page)
  await page.locator('select').selectOption('keep-local')
  page.once('dialog', d => d.accept())
  await page.getByRole('button', {
    name: '⑤ 我已备份两端数据，继续执行选定方向',
  }).click()
  await expect(page.getByText(/与提交前版本完全一致：尚未观察到新版本提交/))
    .toBeVisible({ timeout: 12000 })
  expect(writes).toBe(1)
  expect(reads).toBeGreaterThanOrEqual(4)
  await expect(page.getByRole('button', {
    name: '⑤ 我已备份两端数据，继续执行选定方向',
  })).toBeDisabled()
  await expect(page.getByText(/格式 qwerty-backup-v3，Revision 3/)).toBeVisible()
})

test('P3b ambiguous HTTP 500 after durable commit identifies exact V4 and never retries', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page)
  let current = fixture.meta
  let writes = 0
  await page.route('**/api/sync/v2/meta', r =>
    r.fulfill({ json: { ok: true, ...current } }))
  await page.route('**/api/sync/v2', r =>
    r.fulfill({ json: { ok: true, ...fixture.snapshot } }))
  await page.route('**/api/sync/v2/recovery', async r => {
    writes++
    const posted = r.request().postDataJSON()
    const bytes = Buffer.from(posted.payloadBase64, 'base64')
    const sha = createHash('sha256').update(bytes).digest('hex')
    current = { ...current, revision: 4, sizeBytes: bytes.length,
      clientFormatVersion: 'qwerty-backup-v4',
      logicalFingerprint: posted.logicalFingerprint,
      dataSha256: sha, payloadSha256: sha }
    await r.fulfill({ status: 500, json: {
      ok: false, error: 'internal_error', message: 'Internal server error',
    } })
  })
  await page.goto('/?s2-recovery=manage')
  await archiveBoth(page)
  await page.locator('select').selectOption('keep-local')
  page.once('dialog', d => d.accept())
  await page.getByRole('button', {
    name: '⑤ 我已备份两端数据，继续执行选定方向',
  }).click()
  await expect(page.getByText(/已验证云端创建了匹配本次请求的 V4 新版本/))
    .toBeVisible({ timeout: 12000 })
  expect(writes).toBe(1)
  await expect(page.getByRole('button', {
    name: '⑤ 我已备份两端数据，继续执行选定方向',
  })).toBeDisabled()
  await expect(page.getByText(/格式 qwerty-backup-v4，Revision 4/)).toBeVisible()
})

test('P3b stale cloud revision after backup cancels before any recovery CAS or restore', async ({ page }) => {
  await seed(page)
  const fixture = await remoteFixture(page)
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
  const fixture = await remoteFixture(page)
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

