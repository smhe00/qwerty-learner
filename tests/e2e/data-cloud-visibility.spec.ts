import { expect, test, type Page } from '@playwright/test'

const cloudButtons = [
  '立即同步', '刷新云端状态（只读）', '下载云端完整 V4',
  '高级恢复（V4 冲突处理）',
]

async function showData(page: Page) {
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
}

async function assertLocalOnly(page: Page) {
  for (const name of cloudButtons) {
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  }
  await expect(page.getByText('云端同步', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('每个 Block 完成后自动同步')).toHaveCount(0)
  for (const name of ['导出完整备份','验证 V4 备份文件（只读）',
    '分析备份容量（只读）','导入完整备份 V4（支持跨账号）','清除本地数据']) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }
  await expect(page.getByRole('tabpanel').filter({ hasText: '本地备份' }))
    .not.toContainText('云端备份')
}

test('anonymous data settings hide cloud actions and preserve local backups', async ({ page }) => {
  await page.goto('/')
  await showData(page)
  await assertLocalOnly(page)
})

async function seedAccount(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.initializeLegacyWorkspace))).toBe(true)
  await page.evaluate(async () => {
    const id = 'data-cloud-visibility-test-owner'
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      user: { userId: id, username: 'data-visibility-test' },
      token: 'data-visibility-test-session',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: id })
  })
  await page.goto('/')
}

test('signed-in S1 owner sees cloud settings', async ({ page }) => {
  await seedAccount(page)
  await showData(page)
  await expect(page.getByText('云端同步', { exact: true })).toBeVisible()
  for (const name of cloudButtons) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }
  await expect(page.getByLabel('每个 Block 完成后自动同步')).toBeVisible()
})

test('cross-tab logout revokes visible cloud actions without removing local backup', async ({ page }) => {
  await seedAccount(page)
  await showData(page)
  await expect(page.getByRole('button', { name: '立即同步' })).toBeVisible()
  await page.evaluate(() => {
    localStorage.removeItem('qwerty.cloudAuth.v1')
    window.dispatchEvent(new StorageEvent('storage', { key: 'qwerty.cloudAuth.v1' }))
  })
  await assertLocalOnly(page)
})
