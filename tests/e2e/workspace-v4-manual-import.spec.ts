import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'

const owner = { kind: 'account' as const, accountId: 'v4-import-new-account' }
const oldOwner = { kind: 'account' as const, accountId: 'v4-import-former-account' }

async function init(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async (id) => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'v4-import-fake-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: id, username: 'new-account' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: id })
  }, owner.accountId)
}

async function portableJson(page: Page, original = oldOwner) {
  return page.evaluate(async (sourceId) => {
    const h = (window as any).__backupHarness
    const snapshot = await h.captureWorkingWorkspaceV4({
      kind: 'account', accountId: 'v4-import-new-account',
    })
    snapshot.metadata.source = { kind: 'account', accountId: sourceId }
    snapshot.workspaceData.navigation.currentChapter = 17
    snapshot.workspaceData.settings.values.memoryConfig = {
      dailyNewWordTarget: 21, blockSize: 1, review: 'saved-from-old-account',
    }
    snapshot.workspaceData.learnRuntime.dailySessions.cet4 = {
      version: 1, sessionId: 'cet4:2026-10-10:1', dict: 'cet4', dateKey: '2026-10-10',
      startedAt: 1791590400, status: 'active', dailyNewTarget: 20, plannedNewWords: 5,
      plannedReviewWords: ['backup-fsrs-word'], carryOverAcquisitionWords: [],
      accumulatedActiveSeconds: 70, completedBlockIds: ['test:block'],
      blockCount: 1,
    }
    const wordTable = snapshot.workspaceData.database.data.data.find(
      (row: any) => row.tableName === 'wordRecords',
    )
    wordTable.rows[0].typingTelemetry = {
      durationMs: 122, attempts: [{ key: 'x', failed: false }],
    }
    return JSON.stringify(snapshot)
  }, original.accountId)
}
async function importFile(page: Page, json: string) {
  const buf = gzipSync(Buffer.from(json))
  await page.goto('/?v4-import=manage')
  await expect(page.getByText('本地导入完整 Backup V4')).toBeVisible()
  await page.getByLabel('选择 Backup V4 gzip 文件').setInputFiles({
    name: 'Qwerty-Plus-Backup-V4.gz', mimeType: 'application/gzip', buffer: buf,
  })
  await expect(page.getByText(/备份文件结构与数据表校验通过/)).toBeVisible()
}
async function confirmImport(page: Page, requiresOtherId = true) {
  const action = page.getByRole('button', {
    name: '② 我确认用 V4 备份完整替换当前本地工作区',
  })
  await expect(action).toBeDisabled()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /① 下载当前本地完整 V4 备份/ }).click()
  const downloaded = await downloadPromise
  expect(downloaded.suggestedFilename()).toContain('BEFORE-IMPORT-V4')
  await page.getByLabel('我已确认当前本地备份文件保存成功').check()
  await page.getByLabel(/我明白：将完整替换/).check()
  if (requiresOtherId) await page.getByLabel(/我明确同意把来源不同 ID/).check()
  await page.getByLabel('确认当前接收账号 ID').fill(owner.accountId)
  await expect(action).toBeEnabled()
  page.once('dialog', async dialog => dialog.accept())
  await action.click()
  await expect(page.getByText(/本地完整 V4 恢复完成/)).toBeVisible({ timeout: 30000 })
}

test('Portable V4 cross-account import is explicit, full, journaled and never touches cloud', async ({ page }) => {
  await init(page)
  const before = await page.evaluate(async () =>
    (window as any).__backupHarness.captureWorkingWorkspaceV4(owner))
  const backup = await portableJson(page)
  let cloudCalls = 0
  await page.route('**/api/sync/**', async r => {
    cloudCalls++
    await r.abort()
  })
  await importFile(page, backup)
  const action = page.getByRole('button', { name: /② 我确认用 V4 备份完整替换/ })
  await page.getByLabel('确认当前接收账号 ID').fill(owner.accountId)
  await page.getByLabel(/我明白：将完整替换/).check()
  await expect(action).toBeDisabled()
  await expect(page.getByText(/账号 ID 不同/)).toBeVisible()
  await confirmImport(page)
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.inspect))).toBe(true)
  const actual = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      snapshot: await h.captureWorkingWorkspaceV4(owner),
      baseline: await h.loadSyncV2Baseline(owner.accountId),
      pending: await (await import('/src/sync/manual-v4-import-journal.ts')).manualV4ImportJournalPort.read(),
    }
  })
  expect(actual.snapshot.metadata.source).toEqual(owner)
  expect(actual.snapshot.workspaceData.navigation.currentChapter).toBe(17)
  expect(actual.snapshot.workspaceData.settings.values.memoryConfig).toMatchObject({
    review: 'saved-from-old-account',
  })
  expect(actual.snapshot.workspaceData.learnRuntime.dailySessions.cet4).toMatchObject({
    completedBlockIds: ['test:block'], status: 'active',
  })
  expect(actual.snapshot.workspaceData.database.data.tables.length).toBe(6)
  expect(actual.snapshot.workspaceData.database.data.data.find(
    (x: any) => x.tableName === 'wordRecords',
  ).rows[0].typingTelemetry).toMatchObject({ durationMs: 122 })
  expect(actual.pending).toBeNull()
  expect(actual.baseline).toBeNull()
  expect(before.workspaceData.navigation.currentChapter).not.toBe(17)
  expect(cloudCalls).toBe(0)
})

test('V4 imported local content keeps current account prior cloud baseline invalidated', async ({ page }) => {
  await init(page)
  const legacy = await portableJson(page)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.compareAndSwapSyncV2Baseline('v4-import-new-account', null, {
      accountId: 'v4-import-new-account', baseRevision: 42,
      logicalFingerprint: '0'.repeat(64),
    })
  })
  await importFile(page, legacy)
  await confirmImport(page)
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(async () => page.evaluate(() => Boolean((window as any).__backupHarness?.loadSyncV2Baseline))).toBe(true)
  const state = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      baseline: await h.loadSyncV2Baseline('v4-import-new-account'),
      source: (await h.captureWorkingWorkspaceV4(owner)).metadata.source,
    }
  })
  expect(state).toEqual({ baseline: null, source: owner })
})

test('Crash after durable V4 import staging replays on boot before application can write', async ({ page }) => {
  await init(page)
  const json = await portableJson(page)
  const staged = await page.evaluate(async backupJson => {
    const h = (window as any).__backupHarness
    const { rebindPortableV4Import, preparePortableV4Import } =
      await import('/src/sync/manual-v4-import-plan.ts')
    const { manualV4ImportJournalPort } =
      await import('/src/sync/manual-v4-import-journal.ts')
    const owner = { kind: 'account' as const, accountId: 'v4-import-new-account' }
    const plan = await preparePortableV4Import(backupJson, owner)
    const candidate = await rebindPortableV4Import(backupJson, plan, {
      replaceCurrentLocal: true, acceptDifferentSourceOwner: true,
      destinationConfirmation: owner.accountId,
    })
    const original = await h.captureWorkingWorkspaceV4(owner)
    const reg = await h.workspaceRegistryPort.read()
    await manualV4ImportJournalPort.stage({
      owner, originalOwner: plan.originalOwner,
      registryGeneration: reg.generation, original, candidate,
    })
    // Simulate crash halfway through destructive table restore.
    await h.db.wordRecords.clear()
    return (await manualV4ImportJournalPort.read())?.fingerprint
  }, json)
  expect(staged).toMatch(/^[a-f0-9]{64}$/)
  await page.goto('/')
  await expect(page.getByText(/本地完整 V4 恢复完成/)).toBeVisible({ timeout: 30000 })
  await page.goto('/tests/e2e/backup-harness.html')
  const actual = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      count: await h.db.wordRecords.count(),
      chapter: (await h.inspect()).currentChapter,
      pending: await (await import('/src/sync/manual-v4-import-journal.ts')).manualV4ImportJournalPort.read(),
    }
  })
  expect(actual.count).toBeGreaterThan(0)
  expect(actual.chapter).toBe(17)
  expect(actual.pending).toBeNull()
})

test('Cloud raw V4 download is standard gzip accepted by the same local import', async ({ page }) => {
  await init(page)
  const original = await page.evaluate(async () => JSON.stringify(
    await (window as any).__backupHarness.captureWorkingWorkspaceV4(owner)))
  const payload = gzipSync(Buffer.from(original))
  const sha = createHash('sha256').update(payload).digest('hex')
  const hash = await page.evaluate(async json =>
    (window as any).__backupHarness.workspaceFingerprintV4(JSON.parse(json)), original)
  const meta = {
    ok: true, hasData: true, revision: 5, sizeBytes: payload.byteLength,
    payloadSha256: sha, dataSha256: sha, logicalFingerprint: hash,
    clientFormatVersion: 'qwerty-backup-v4', updatedAt: '2026-10-11T00:00:00Z',
  }
  await page.route('**/api/sync/v2/meta', r => r.fulfill({ json: meta }))
  await page.route('**/api/sync/v2', r => r.fulfill({ json: {
    ...meta, payloadEncoding: 'base64', payloadBase64: payload.toString('base64'),
  } }))
  await page.goto('/?v4-cloud-backup=download')
  await expect(page.getByText('导出云端完整 Backup V4')).toBeVisible()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载标准 V4 文件/ }).click()
  const file = await dl
  const stream = await file.createReadStream()
  const chunks: Buffer[] = []
  for await (const data of stream) chunks.push(Buffer.from(data))
  const archived = gunzipSync(Buffer.concat(chunks))
  expect(JSON.parse(archived.toString('utf8'))).toEqual(JSON.parse(original))
})
