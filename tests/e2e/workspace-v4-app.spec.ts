import { expect, test } from '@playwright/test'
import { gunzipSync } from 'node:zlib'
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
  await expect(page.getByRole('status')).toContainText('V4 导出完成')

  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '验证 V4 备份文件（只读）' }).click()
  const chooser = await fileChooser
  await chooser.setFiles({ name: 'v4-test.gz', mimeType: 'application/gzip', buffer })
  await expect(page.getByRole('status')).toContainText('V4 校验通过')
  await expect(page.getByRole('status')).toContainText('未修改本地数据')

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
  await page.getByRole('button', { name: '验证 V4 备份文件（只读）' }).click()
  const chooser = await fileChooser
  await chooser.setFiles({ name: 'bad.gz', mimeType: 'application/gzip', buffer: Buffer.from('not gzip') })
  await expect(page.getByRole('status')).toContainText('V4 校验失败')
  await page.goto('/tests/e2e/backup-harness.html')
  const data = await page.evaluate(() => (window as any).__backupHarness.inspect())
  expect(data.wordRecord?.fsrsShadow?.algorithmModel).toBe('fsrs-6')
})
