import { expect, test } from '@playwright/test'

const USER = { userId: 'maker-preview-immutable-account', username: 'migration-preview' }
const TOKEN = 'fake-preview-token-not-a-production-credential'

test('production build enables explicit S1 account migration and V4 recovery only after consent', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, json: { ok: true, user: USER },
  }))
  await page.route('**/api/sync/v2/meta', route => route.fulfill({
    json: { ok: true, hasData: false, revision: 0, updatedAt: null,
      sizeBytes: 0, dataSha256: null, payloadSha256: null,
      logicalFingerprint: null, clientFormatVersion: null,
      deviceId: null },
  }))
  await page.addInitScript(({ user, token }) => {
    if (!localStorage.getItem('qwerty.cloudAuth.v1')) {
      localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
        user, token, expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }))
    }
  }, { user: USER, token: TOKEN })

  // This is the actual yarn build production preview, not Vite's DEV bypass.
  await page.goto('/?s1-migration=confirm')
  await expect(page.getByText('S1 本机学习数据归属确认')).toBeVisible()
  await expect(page.getByText(USER.userId, { exact: false })).toBeVisible()
  const action = page.getByRole('button', { name: '确认归属并建立隔离工作区' })
  await expect(action).toBeDisabled()
  await page.getByRole('checkbox', { name: '已核对本机完整 V4 备份' }).check()
  await expect(action).toBeEnabled()
  await action.click()
  await expect.poll(() => new URL(page.url()).search).toBe('')
  await page.goto('/?s1-account=manage')
  await expect(page.locator('[data-s1-current-owner]')).toHaveAttribute(
    'data-s1-current-owner', USER.userId)
  await expect(page.getByText('安全账户管理（S1）')).toBeVisible()
  // Production S2 recovery UI is present for the migrated account.
  // Simulated backend has no snapshot so it must not change data.
  await page.goto('/?s2-recovery=manage')
  await expect(page.getByText('云同步高级恢复（S2）')).toBeVisible()
  await expect(page.getByText('当前云端没有可按 P3b 恢复的 V3/V4 数据。请返回普通 Sync；不做覆盖。')).toBeVisible()
})
