import { gzipSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'

const destinationToken = 'LOCAL-ANONYMOUS'
const sourceId = 'v4-copy-button-source-account'

async function initAnonymous(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.initializeLegacyWorkspace))).toBe(true)
  const backup = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.removeItem('qwerty.cloudAuth.v1')
    await h.initializeLegacyWorkspace({ kind: 'anonymous' })
    const snapshot = await h.captureWorkingWorkspaceV4({ kind: 'anonymous' })
    snapshot.metadata.source = { kind: 'account', accountId: 'v4-copy-button-source-account' }
    return JSON.stringify(snapshot)
  })
  await page.goto('/?v4-import=manage')
  await expect(page.getByRole('heading', { name: '本地导入完整 Backup V4' })).toBeVisible()
  return backup
}

test('anonymous V4 destination displays exact LOCAL-ANONYMOUS value and copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await initAnonymous(page)

  const target = page.getByText(destinationToken, { exact: true })
  const copy = page.getByRole('button', { name: '复制当前接收账号 ID' })
  await expect(target).toBeVisible()
  await expect(page.getByText('（本机匿名工作区）')).toBeVisible()
  await expect(copy).toBeVisible()
  await copy.click()
  await expect(page.getByText('已复制', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(destinationToken)

  const confirmation = page.getByLabel('确认当前接收账号 ID')
  await expect(confirmation).toHaveValue('')
  await confirmation.focus()
  await page.keyboard.press('ControlOrMeta+V')
  await expect(confirmation).toHaveValue(destinationToken)
})

test('source ID remains distinct and destination copy survives selecting a cross-account file', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const backup = await initAnonymous(page)
  await page.getByLabel('选择 Backup V4 gzip 文件').setInputFiles({
    name: 'source-cloud-v4.gz',
    mimeType: 'application/gzip',
    buffer: gzipSync(Buffer.from(backup)),
  })
  await expect(page.getByText(/备份文件结构与数据表校验通过/)).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('备份来源 ID：' + sourceId)).toBeVisible()
  await expect(page.getByText('当前接收账号 ID：')).toBeVisible()
  await expect(page.getByText(destinationToken, { exact: true })).toBeVisible()
  await expect(page.getByText(/账号 ID 不同/)).toBeVisible()

  await page.getByRole('button', { name: '复制当前接收账号 ID' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(destinationToken)
  await expect(page.getByLabel('确认当前接收账号 ID')).toHaveValue('')
  await expect(page.getByRole('button', { name: /② 我确认用 V4 备份完整替换/ })).toBeDisabled()
})

test('logged-in V4 destination shows and copies its immutable ID, not the backup source ID', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.initializeLegacyWorkspace))).toBe(true)
  await page.evaluate(async () => {
    const id = 'v4-copy-button-target-account'
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'v4-copy-test-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: id, username: 'target-account' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: id })
  })
  await page.goto('/?v4-import=manage')
  await expect(page.getByText('v4-copy-button-target-account', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '复制当前接收账号 ID' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('v4-copy-button-target-account')
  await expect(page.getByText('（本机匿名工作区）')).toHaveCount(0)
})
