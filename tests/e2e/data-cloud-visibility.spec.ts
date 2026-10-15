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
