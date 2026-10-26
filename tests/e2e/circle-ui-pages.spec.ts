import { expect, test } from '@playwright/test'

test('Pages disables both entries and direct Circle routes even with saved valid credentials', async ({ page }) => {
  const apiPaths: string[] = []
  await page.route('**/api/**', async (route) => { apiPaths.push(new URL(route.request().url()).pathname); await route.abort() })
  await page.goto('/qwerty-learner/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: 'pages-circle-fixture', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: 'pages-fixture-user', username: '预览账号' },
    }))
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: 'pages-fixture-user' })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/qwerty-learner/learn')
  await expect(page.locator('[data-circle-entry]')).toBeDisabled({ timeout: 30000 })
  await page.goto('/qwerty-learner/circles')
  await expect(page.getByText('当前预览版暂不支持圈子。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '创建', exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/qwerty-learner/mobile')
  await expect(page.getByRole('button', { name: '圈子（登录后可用）', exact: true })).toBeDisabled()
  await page.goto('/qwerty-learner/mobile/circles')
  await expect(page.getByText('当前预览版暂不支持圈子。', { exact: true })).toBeVisible()
  // Existing app startup may probe public health; no Circle/auth/sync request is allowed.
  expect(apiPaths.filter((path) => path !== '/api/health')).toEqual([])
})
