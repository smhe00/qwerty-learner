import { expect, test } from '@playwright/test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('application settings exports complete V4 gzip and validates it without changing Learn records', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.learn.dailySession.v1.cet4', JSON.stringify({
      version: 1,
      sessionId: 'cet4:2026-10-09:1',
      dict: 'cet4',
      dateKey: '2026-10-09',
      startedAt: 100,
      status: 'active',
      dailyNewTarget: 32,
      plannedNewWords: 3,
      plannedReviewWords: ['backup-fsrs-word'],
      carryOverAcquisitionWords: [],
      accumulatedActiveSeconds: 21,
      completedBlockIds: ['block-1'],
      blockCount: 1,
    }))
    localStorage.setItem('memoryConfig', JSON.stringify({ blockSize: 1, dailyNewWordTarget: 32 }))
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ token: 'DO_NOT_EXPORT' }))
  })
  await page.goto('/')
  const settings = page.getByRole('button', { name: '打开设置对话框' })
  await expect(settings).toBeVisible()
  await settings.click()
  await page.getByRole('tab', { name: '数据设置' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整备份' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/Qwerty-Plus-Backup-V4-.*\.gz$/)
  const buffer = await readFile(await download.path() as string)
  const json = gunzipSync(buffer).toString('utf8')
  const snapshot = JSON.parse(json)
  expect(snapshot.backupFormatVersion).toBe('qwerty-backup-v4')
  expect(snapshot.workspaceData.database.data.tables).toHaveLength(6)
  expect(snapshot.workspaceData.learnRuntime.dailySessions.cet4.completedBlockIds).toEqual(['block-1'])
  expect(snapshot.workspaceData.settings.values.memoryConfig.blockSize).toBe(1)
  expect(json).not.toContain('DO_NOT_EXPORT')
  await expect(page.getByRole('status')).toContainText('备份已导出')

  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '校验备份文件' }).click()
  const chooser = await fileChooser
  await chooser.setFiles({ name: 'v4-test.gz', mimeType: 'application/gzip', buffer })
  await expect(page.getByRole('status')).toContainText('校验通过')
  await expect(page.getByRole('status')).toContainText('本地数据未改变')

  await page.goto('/tests/e2e/backup-harness.html')
  const data = await page.evaluate(() => (window as any).__backupHarness.inspect())
  expect(data.wordRecord?.fsrsShadow?.algorithmModel).toBe('fsrs-6')
  expect(data.reviewRecord?.isFinished).toBe(false)
  expect(data.achievementState?.achievementId).toBe('ACH_BACKUP_ROUNDTRIP')
})

test('application rejects a non-V4 file without modifying the current workspace', async ({ page }) => {
  await page.goto('/tests/e2e/backup-harness.html')
  await page.evaluate(() => (window as any).__backupHarness.seed())
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '校验备份文件' }).click()
  const chooser = await fileChooser
  await chooser.setFiles({ name: 'bad.gz', mimeType: 'application/gzip', buffer: Buffer.from('not gzip') })
  await expect(page.getByRole('status')).toContainText('备份校验失败')
  await page.goto('/tests/e2e/backup-harness.html')
  const data = await page.evaluate(() => (window as any).__backupHarness.inspect())
  expect(data.wordRecord?.fsrsShadow?.algorithmModel).toBe('fsrs-6')
})

const signedInBackupOwner = { kind: 'account' as const, accountId: 'download-logged-in-test-owner' }

async function seedSignedInBackup(page: import('@playwright/test').Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  return page.evaluate(async account => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      user: { userId: account.accountId, username: 'local-download-test' },
      token: 'mocked-download-only-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }))
    await h.initializeLegacyWorkspace(account)
    const snapshot = await h.captureWorkingWorkspaceV4(account)
    return {
      json: JSON.stringify(snapshot),
      fingerprint: await h.workspaceFingerprintV4(snapshot),
    }
  }, signedInBackupOwner)
}

test('S1 signed-in account can download its own complete local Backup V4', async ({ page }) => {
  await seedSignedInBackup(page)
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  const downloadPending = page.waitForEvent('download', { timeout: 25_000 })
  await page.getByRole('button', { name: '导出完整备份' }).click()
  const download = await downloadPending
  const snapshot = JSON.parse(gunzipSync(await readFile(await download.path() as string)).toString('utf8'))
  expect(snapshot.backupFormatVersion).toBe('qwerty-backup-v4')
  expect(snapshot.metadata.source).toEqual(signedInBackupOwner)
  expect(snapshot.workspaceData.database.data.tables).toHaveLength(6)
  await expect(page.getByRole('status')).toContainText('备份已导出')
})

test('S1 signed-in account can download verified cloud Backup V4 with unchanged revision', async ({ page }) => {
  const archive = await seedSignedInBackup(page)
  const zipped = gzipSync(Buffer.from(archive.json, 'utf8'))
  const hash = createHash('sha256').update(zipped).digest('hex')
  const meta = {
    hasData: true, revision: 7, updatedAt: new Date().toISOString(),
    sizeBytes: zipped.byteLength, dataSha256: hash, payloadSha256: hash,
    logicalFingerprint: archive.fingerprint, deviceId: 'mocked-backup-device',
    clientFormatVersion: 'qwerty-backup-v4',
  }
  await page.route('**/api/sync/v2/meta', async route => {
    await route.fulfill({ json: { ok: true, ...meta } })
  })
  await page.route('**/api/sync/v2', async route => {
    expect(route.request().method()).toBe('GET')
    await route.fulfill({ json: {
      ok: true, ...meta,
      payloadEncoding: 'base64', payloadBase64: zipped.toString('base64'),
    } })
  })
  // Exercise the REAL Settings -> cloud download full-page navigation. The
  // mounted app owns the S1 Web Lock, which a direct test URL would miss.
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  await page.getByRole('button', { name: '下载云端备份' }).click()
  await expect(page).toHaveURL(/v4-cloud-backup=download/)
  const save = page.getByRole('button', { name: '下载标准 V4 文件（.gz）' })
  await expect(save).toBeEnabled({ timeout: 25_000 })
  const downloadPending = page.waitForEvent('download', { timeout: 25_000 })
  await save.click()
  const download = await downloadPending
  expect(download.suggestedFilename()).toBe('Qwerty-Plus-CLOUD-Backup-V4-r7.gz')
  const actual = await readFile(await download.path() as string)
  expect(createHash('sha256').update(actual).digest('hex')).toBe(hash)
  await expect(page.getByRole('status')).toContainText('已触发标准 V4 文件下载')
})

test('signed-in V4 export handles growing Learn/Typing, completed sessions and achievement ledger', async ({ page }) => {
  await seedSignedInBackup(page)
  const counts = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    const initial = await h.db.wordRecords.toArray()
    const base = JSON.parse(JSON.stringify(initial[0]))
    const words = Array.from({ length: 800 }, (_, i) => {
      const record = { ...base, word: 'realistic-' + i,
        timeStamp: base.timeStamp + i,
        timing: Array.from({ length: 12 }, (_, n) => 75 + (n * 13 + i) % 233),
        mistakes: { 1: ['x'], 5: ['q'] },
        typingTelemetry: {
          telemetryVersion: 2, firstKeyLatencyMs: 250 + i % 200,
          attempts: Array.from({ length: 4 }, (_, j) => ({
            startLatencyMs: 100 + j * 21, durationMs: 900 + i % 130,
            correctPrefixLength: 5, result: j < 3 ? 'wrong' : 'clean',
            wrongIndex: j < 3 ? j + 1 : undefined, wrongKey: j < 3 ? 'x' : undefined,
            interKeyIntervalsMs: Array.from({ length: 10 }, (_, k) => 65 + (k * 19 + i) % 166),
          })),
        },
      }
      delete record.id
      return record
    })
    await h.db.wordRecords.bulkAdd(words)
    const finished = Array.from({ length: 70 }, (_, i) => ({
      dict: 'cet4', index: 20, createTime: 1_800_000_000 + i,
      isFinished: true,
      words: Array.from({ length: 20 }, (_, j) => ({
        name: 'word-' + i + '-' + j,
        trans: ['a vocabulary definition', 'meaning repeated'],
        example: [{ en: 'An example sentence with word information',
          cn: '这是一个例句用于复习', start: 12, end: 20 }],
      })),
      acquisitionStates: {},
    }))
    await h.db.reviewRecords.bulkAdd(finished)
    const events = Array.from({ length: 350 }, (_, i) => ({
      eventId: 's1-stress-event:' + i,
      eventType: 'word_attempt', origin: 'live',
      sourceRecordId: 1, occurredAt: 1_800_000_000 + i,
      dict: 'cet4', word: 'word-' + i,
      metricValues: Object.fromEntries(Array.from({ length: 25 }, (_, j) =>
        ['metric_' + j, (i + j) % 9 === 0 ? 1 : 0])),
      unlockedAchievementIds: [],
    }))
    await h.db.achievementEvents.bulkAdd(events)
    const template = await h.db.reviewWordStates.toCollection().first()
    await h.db.reviewWordStates.bulkAdd(Array.from({ length: 180 }, (_, i) => {
      const row = { ...template, word: 'longterm-' + i }
      delete row.id
      return row
    }))
    return {
      words: await h.db.wordRecords.count(),
      sessions: await h.db.reviewRecords.count(),
      events: await h.db.achievementEvents.count(),
      states: await h.db.reviewWordStates.count(),
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  const downloadPending = page.waitForEvent('download', { timeout: 45_000 })
  await page.getByRole('button', { name: '导出完整备份' }).click()
  const download = await downloadPending
  const snapshot = JSON.parse(gunzipSync(await readFile(await download.path() as string)).toString('utf8'))
  expect(snapshot.metadata.source).toEqual(signedInBackupOwner)
  const byTable = Object.fromEntries(snapshot.workspaceData.database.data.data.map(
    (table: { tableName: string; rows: unknown[] }) => [table.tableName, table.rows.length]))
  expect(byTable.wordRecords).toBe(counts.words)
  expect(byTable.reviewRecords).toBe(counts.sessions)
  expect(byTable.achievementEvents).toBe(counts.events)
  expect(byTable.reviewWordStates).toBe(counts.states)
  await expect(page.getByRole('status')).toContainText('备份已导出')
})
