import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

test('desktop header opens the shared account page with keyboard focus and registration policy', async ({ page }, testInfo) => {
  await page.goto('/')
  const entry = page.getByRole('button', { name: '账号：登录或注册', exact: true })
  await expect(entry).toBeVisible({ timeout: 30_000 })
  await entry.click()
  await page.getByRole('button', { name: '登录或注册', exact: true }).click()
  await expect(page.locator('[data-desktop-account]')).toBeVisible()
  await expect(page).toHaveURL(/\/\?s1-account=manage&s1-reauth=1$/)
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
  await expect(page.getByLabel('用户名', { exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toHaveCount(0)
  await expect(page.getByText('练打字 · 记单词 · 云同步', { exact: true })).toBeVisible()
  const card = await page.locator('.mobile-account-card').boundingBox()
  expect(card?.width).toBe(480)
  expect(card!.x + card!.width / 2).toBe(720)
  await page.screenshot({ path: testInfo.outputPath('desktop-login-light.png'), fullPage: true })
  await page.getByRole('tab', { name: '登录', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '注册', exact: true })).toBeFocused()
  const notice = page.getByRole('complementary', { name: '注册须知' })
  await expect(notice).toContainText('暂不支持账号找回或密码重置')
  await expect(notice).toContainText('连续超过 6 个月未使用的账号将自动删除')
  await expect(page.getByRole('button', { name: '注册并登录' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('desktop-register-light.png'), fullPage: true })
  await page.keyboard.press('ArrowLeft')
  await expect(notice).toBeHidden()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page).toHaveURL(/\/(?:learn)?$/)
  await expect(entry).toBeVisible()
})

test('desktop native form submits once with Enter and keeps errors on the shared page', async ({ page }, testInfo) => {
  let calls = 0
  await page.route('**/api/auth/login', (route) => {
    calls++
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_credentials' }) })
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/?s1-account=manage')
  await expect(page.locator('[data-desktop-account]')).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('用户名', { exact: true }).fill('desktop-fixture')
  await page.getByLabel('账户密码', { exact: true }).fill('fixture-password')
  await page.getByLabel('账户密码', { exact: true }).press('Enter')
  await expect(page.getByRole('status')).toContainText('用户名或密码不正确')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
  expect(calls).toBe(1)
  await expect(page.locator('[data-account]')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: testInfo.outputPath('desktop-login-dark.png'), fullPage: true })
  for (const width of [1024, 800, 640]) {
    await page.setViewportSize({ width, height: 768 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    const card = await page.locator('.mobile-account-card').boundingBox()
    expect(Math.abs(card!.x + card!.width / 2 - width / 2)).toBeLessThan(1)
  }
})

for (const expired of [false, true]) {
  test('desktop ' + (expired ? 'expired' : 'valid') + ' account reauth preserves its workspace and returns to PC', async ({ page }) => {
    await page.goto('/tests/e2e/backup-harness.html')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
    const before = await page.evaluate(async (expired) => {
      const h = (window as any).__backupHarness
      await h.seed()
      localStorage.setItem(
        'qwerty.cloudAuth.v1',
        JSON.stringify({
          token: 'fixture-token',
          expiresAt: Math.floor(Date.now() / 1000) + (expired ? -10 : 3600),
          user: { userId: 'desktop-owner', username: 'desktop-user' },
        }),
      )
      await h.initializeLegacyWorkspace({ kind: 'account', accountId: 'desktop-owner' })
      return { registry: await h.workspaceRegistryPort.read(), count: await h.db.wordRecords.count() }
    }, expired)
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          token: 'new-fixture-token',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          expiresIn: 3600,
          user: { userId: 'desktop-owner', username: 'desktop-user' },
        }),
      }),
    )
    await page.goto('/?s1-account=manage')
    await expect(page.getByRole('heading', { name: '我的账号' })).toBeVisible()
    if (!expired) {
      await expect(page.getByLabel('账户密码', { exact: true })).toBeHidden()
      await page.getByRole('button', { name: '重新验证登录', exact: true }).click()
    }
    await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('desktop-user')
    await page.getByLabel('账户密码', { exact: true }).fill('fixture-password')
    await page.getByRole('button', { name: '确认重新登录', exact: true }).click()
    await expect(page).toHaveURL(/\/(?:learn)?$/)
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible({ timeout: 30_000 })
    await page.goto('/tests/e2e/backup-harness.html')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
    const after = await page.evaluate(async () => {
      const h = (window as any).__backupHarness
      return { registry: await h.workspaceRegistryPort.read(), count: await h.db.wordRecords.count() }
    })
    expect(after.registry.active).toEqual(before.registry.active)
    expect(after.registry.generation).toBe(before.registry.generation)
    expect(after.count).toBe(before.count)
  })
}
