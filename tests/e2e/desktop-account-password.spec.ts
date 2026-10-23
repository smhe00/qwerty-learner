import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, mobile: boolean) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  const before = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem(
      'qwerty.cloudAuth.v1',
      JSON.stringify({
        token: 'old-fixture-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: { userId: 'password-owner', username: 'password-user' },
      }),
    )
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: 'password-owner' })
    return { registry: await h.workspaceRegistryPort.read(), count: await h.db.wordRecords.count() }
  })
  await page.goto(mobile ? '/mobile/account' : '/?s1-account=manage')
  await expect(page.getByRole('heading', { name: '我的账号' })).toBeVisible()
  await page.getByRole('button', { name: '修改密码', exact: true }).click()
  return before
}
async function fill(page: Page) {
  await page.getByLabel('当前密码', { exact: true }).fill('old-password')
  await page.getByLabel('新密码', { exact: true }).fill('new-password')
  await page.getByLabel('确认新密码', { exact: true }).fill('new-password')
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'phone password change' : 'desktop password change', () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile })

    test('login distinguishes missing accounts and wrong passwords without switching owner', async ({ page }) => {
      let code = 'account_not_found'
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: code }) }),
      )
      await page.goto(mobile ? '/mobile/account' : '/?s1-account=manage')
      await page.getByLabel('用户名', { exact: true }).fill('login-fixture')
      await page.getByLabel('账户密码', { exact: true }).fill('test-password')
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('账号不存在，请检查用户名或先注册')
      code = 'incorrect_password'
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('密码不正确，请重新输入')
      await expect(page.getByRole('status')).not.toContainText('账号不存在')
      expect(await page.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBeNull()
    })
    test('new token is committed to the same owner without changing learning records', async ({ page }, testInfo) => {
      const before = await fixture(page, mobile)
      const requests: unknown[] = []
      await page.route('**/api/auth/change-password', (route) => {
        requests.push({ body: route.request().postDataJSON(), authorization: route.request().headers().authorization })
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            token: 'changed-fixture-token',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            expiresIn: 3600,
            user: { userId: 'password-owner', username: 'password-user' },
          }),
        })
      })
      await fill(page)
      await page.screenshot({
        path: testInfo.outputPath(mobile ? 'phone-change-password.png' : 'desktop-change-password.png'),
        fullPage: true,
      })
      await page.getByLabel('确认新密码', { exact: true }).press('Enter')
      await expect(page).toHaveURL(mobile ? /\/mobile$/ : /\/$/)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        body: { currentPassword: 'old-password', newPassword: 'new-password' },
        authorization: 'Bearer old-fixture-token',
      })
      await page.goto('/tests/e2e/backup-harness.html')
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
      const after = await page.evaluate(async () => {
        const h = (window as any).__backupHarness
        return {
          registry: await h.workspaceRegistryPort.read(),
          count: await h.db.wordRecords.count(),
          token: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').token,
        }
      })
      expect(after.registry.active).toEqual(before.registry.active)
      expect(after.registry.generation).toBe(before.registry.generation)
      expect(after.count).toBe(before.count)
      expect(after.token).toBe('changed-fixture-token')
    })
    test('invalid confirmation, wrong password and unknown result preserve local credentials', async ({ page }) => {
      await fixture(page, mobile)
      let calls = 0
      await page.route('**/api/auth/change-password', (route) => {
        calls++
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_credentials' }) })
      })
      await fill(page)
      await page.getByLabel('确认新密码', { exact: true }).fill('mismatch')
      await page.getByRole('button', { name: '确认修改密码', exact: true }).click()
      expect(calls).toBe(0)
      await page.getByLabel('确认新密码', { exact: true }).fill('new-password')
      await page.getByRole('button', { name: '确认修改密码', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('当前密码不正确')
      await page.unroute('**/api/auth/change-password')
      await page.route('**/api/auth/change-password', (route) => route.abort())
      await page.getByRole('button', { name: '确认修改密码', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('未能确认密码修改结果')
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').token)).toBe('old-fixture-token')
      await expect(page.getByRole('button', { name: '返回', exact: true })).toBeEnabled()
    })
  })
}
