import { test, expect } from '@playwright/test'

test('Block screen has no exit or continue control while syncing', async ({ page }) => {
  await page.goto('/tests/e2e/learn-block-sync-ui-harness.html')
  await expect(page.getByText('正在同步学习进度…')).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  await expect(page.getByText('Block 阶段完成')).toBeVisible()
})

test('Successful sync unlocks continue and exit without a popup', async ({ page }) => {
  await page.goto('/tests/e2e/learn-block-sync-ui-harness.html')
  await page.evaluate(() => {
    (window as unknown as { __blockSyncScreen: {
      settle(x: { kind: 'ok'; message: string }): void
    } }).__blockSyncScreen.settle({ kind: 'ok', message: '同步完成' })
  })
  await expect(page.getByText('同步完成')).toBeVisible()
  await expect(page.getByRole('button', { name: '继续学习' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '结束并退出' })).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Sync failure retains local-only exit and explicit retry', async ({ page }) => {
  await page.goto('/tests/e2e/learn-block-sync-ui-harness.html')
  await page.evaluate(() => {
    (window as unknown as { __blockSyncScreen: {
      settle(x: { kind: 'failed'; message: string }): void
    } }).__blockSyncScreen.settle({ kind: 'failed', message: '同步冲突，本地记录已保留' })
  })
  await expect(page.getByRole('button', { name: '重试同步' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '保留本地进度，暂不同步' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '继续学习' })).toHaveCount(0)
})