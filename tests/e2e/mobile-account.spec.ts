import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const account = (page: Page) => page.locator('[data-mobile-account]')
async function open(page: Page) {
  await page.goto('/mobile/account')
  await expect(account(page)).toBeVisible()
}
async function harness(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
}
async function seed(page: Page, owner?: string, expired = false) {
  await harness(page)
  await page.evaluate(
    async ({ owner, expired }) => {
      const h = (window as any).__backupHarness
      await h.seed()
      if (owner)
        localStorage.setItem(
          'qwerty.cloudAuth.v1',
          JSON.stringify({
            token: 'fixture-token',
            expiresAt: Math.floor(Date.now() / 1000) + (expired ? -10 : 3600),
            user: { userId: owner, username: 'mobile-user' },
          }),
        )
      await h.initializeLegacyWorkspace(owner ? { kind: 'account', accountId: owner } : h.ANONYMOUS)
    },
    { owner, expired },
  )
}
async function state(page: Page) {
  await harness(page)
  return page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return {
      active: (await h.workspaceRegistryPort.read()).active,
      count: await h.db.wordRecords.count(),
      auth: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')?.user.userId || null,
      anonymousSaved: Boolean(await h.loadWorkspaceFromVault(h.ANONYMOUS)),
    }
  })
}
async function credentials(page: Page) {
  await page.getByLabel('用户名', { exact: true }).fill('mobile-user')
  await page.getByLabel('账户密码', { exact: true }).fill('fixture-password')
}
async function mockAuth(page: Page, path = 'login', userId = 'mobile-account-A') {
  await page.route('**/api/auth/' + path, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: { userId, username: 'mobile-user' },
        token: 'synthetic-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        expiresIn: 3600,
      }),
    }),
  )
}

test('both phone menu entries open the guarded login surface and back keeps local study', async ({ page }) => {
  await page.goto('/mobile')
  await page.getByRole('link', { name: '登录或注册', exact: true }).tap()
  await expect(account(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT')
  await expect(page.locator('[data-mobile-menu], header nav, [data-mobile-word-practice]')).toHaveCount(0)
  await page.getByRole('button', { name: '返回', exact: true }).tap()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await page.getByRole('link', { name: /账号与云同步/ }).tap()
  await expect(account(page)).toBeVisible()
  await page.getByRole('button', { name: '暂不登录，继续本机学习' }).tap()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})

test('registration tabs, native validation and password visibility never send unintended requests', async ({ page }) => {
  let calls = 0
  await page.route('**/api/auth/**', (route) => {
    calls++
    return route.abort()
  })
  await open(page)
  await expect(page.getByLabel('注册密码确认')).toBeHidden()
  await expect(page.getByRole('complementary', { name: '注册须知' })).toBeHidden()
  await credentials(page)
  await page.getByRole('button', { name: '显示密码', exact: true }).tap()
  await expect(page.getByLabel('账户密码', { exact: true })).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: '隐藏密码', exact: true }).tap()
  await page.getByRole('tab', { name: '注册', exact: true }).tap()
  await expect(page.getByRole('complementary', { name: '注册须知' })).toContainText('暂不支持账号找回或密码重置')
  await expect(page.getByRole('complementary', { name: '注册须知' })).toContainText('连续超过 6 个月未使用的账号将自动删除')
  await expect(page.getByLabel('账户密码', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
  await page.getByLabel('注册密码确认').fill('different')
  await page.getByRole('button', { name: '注册并登录' }).tap()
  expect(calls).toBe(0)
  expect(await page.getByLabel('注册密码确认').evaluate((el: HTMLInputElement) => el.validity.customError)).toBe(true)
  await page.getByRole('tab', { name: '登录', exact: true }).tap()
  await expect(page.getByLabel('账户密码', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
  await expect(page.getByLabel('注册密码确认')).toBeHidden()
})

test('wrong credentials and network failures show useful errors without changing the owner', async ({ page }) => {
  await seed(page)
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_credentials', message: 'Invalid username or password' }),
    }),
  )
  await open(page)
  await credentials(page)
  await page.getByRole('button', { name: '登录', exact: true }).tap()
  await expect(page.getByRole('status')).toContainText('用户名或密码不正确')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
  await page.unroute('**/api/auth/login')
  await page.route('**/api/auth/login', (route) => route.abort())
  await page.getByRole('button', { name: '登录', exact: true }).tap()
  await expect(page.getByRole('status')).toContainText('检查网络')
  expect(await state(page)).toMatchObject({ active: { kind: 'anonymous' }, count: 1, auth: null })
})

test('successful login and offline logout preserve separate anonymous learning records', async ({ page }) => {
  await seed(page)
  await mockAuth(page)
  const authRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) authRequests.push(request.url())
  })
  page.on('dialog', (dialog) => dialog.accept())
  await open(page)
  await credentials(page)
  await page.getByLabel('账户密码', { exact: true }).press('Enter')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(await state(page)).toMatchObject({
    active: { kind: 'account', accountId: 'mobile-account-A' },
    count: 0,
    auth: 'mobile-account-A',
    anonymousSaved: true,
  })
  await open(page)
  await expect(page.getByRole('heading', { name: '我的账号' })).toBeVisible()
  await expect(page.getByText('mobile-user', { exact: true })).toBeVisible()
  await expect(page.getByLabel('账户密码', { exact: true })).toBeHidden()
  const before = authRequests.length
  await page.context().setOffline(true)
  const offlineNavigation = page.waitForEvent('requestfailed', {
    predicate: (request) => request.isNavigationRequest() && /\/mobile$/.test(request.url()),
  })
  await page.getByRole('button', { name: '安全退出登录' }).tap()
  await offlineNavigation
  await page.context().setOffline(false)
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(authRequests).toHaveLength(before)
  expect(await state(page)).toMatchObject({ active: { kind: 'anonymous' }, count: 1, auth: null })
})

test('cancelled login does not save credentials or switch the anonymous workspace', async ({ page }) => {
  await seed(page)
  await mockAuth(page)
  page.once('dialog', (dialog) => dialog.dismiss())
  await open(page)
  await credentials(page)
  await page.getByRole('button', { name: '登录', exact: true }).tap()
  await expect(page.getByRole('status')).toContainText('已取消登录')
  expect(await state(page)).toMatchObject({ active: { kind: 'anonymous' }, count: 1, auth: null })
})

test('registration can copy anonymous learning records and retains the original', async ({ page }) => {
  await seed(page)
  await mockAuth(page, 'register', 'mobile-new-account')
  page.on('dialog', (dialog) => dialog.accept())
  await open(page)
  await page.getByRole('tab', { name: '注册', exact: true }).tap()
  await credentials(page)
  await page.getByLabel('注册密码确认').fill('fixture-password')
  await page.getByRole('button', { name: '注册并登录' }).tap()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(await state(page)).toMatchObject({ active: { kind: 'account', accountId: 'mobile-new-account' }, count: 1, anonymousSaved: true })
})

test('expired account reauth keeps the same immutable owner and records', async ({ page }) => {
  await seed(page, 'mobile-expired-account', true)
  await mockAuth(page, 'login', 'mobile-expired-account')
  await open(page)
  await expect(page.getByText('登录已过期 · 本机学习记录仍保留')).toBeVisible()
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('mobile-user')
  await page.getByLabel('账户密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '确认重新登录' }).tap()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(await state(page)).toMatchObject({
    active: { kind: 'account', accountId: 'mobile-expired-account' },
    count: 1,
    auth: 'mobile-expired-account',
  })
})

test('busy requests block duplicate submits and account navigation', async ({ page }) => {
  let calls = 0
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/login', async (route) => {
    calls++
    await barrier
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_credentials' }) })
  })
  await open(page)
  await credentials(page)
  await page.getByRole('button', { name: '登录', exact: true }).tap()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeDisabled()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  expect(calls).toBe(1)
  release()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
})

test('phone login remains usable in both themes, short viewport and tablet rotation', async ({ page }, testInfo) => {
  await open(page)
  for (const [width, height] of [
    [320, 568],
    [390, 450],
    [768, 1024],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    const bounds = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, width: window.innerWidth }))
    expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1)
    await page.getByRole('button', { name: '登录', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeInViewport()
    await expect(account(page)).toBeVisible()
  }
  await page.getByRole('heading').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('mobile-login-light.png'), fullPage: true })
  await page.evaluate(() => localStorage.setItem('isOpenDarkModeAtom', 'true'))
  await page.reload()
  await expect(account(page)).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: testInfo.outputPath('mobile-login-dark.png'), fullPage: true })
})

test('reauth cannot replace the current immutable account with another user', async ({ page }) => {
  await seed(page, 'mobile-fixed-owner', true)
  await mockAuth(page, 'login', 'different-owner')
  await open(page)
  await credentials(page)
  await page.getByRole('button', { name: '确认重新登录' }).tap()
  await expect(page.getByRole('status')).toContainText('本机学习记录仍保留')
  expect(await state(page)).toMatchObject({
    active: { kind: 'account', accountId: 'mobile-fixed-owner' },
    count: 1,
    auth: 'mobile-fixed-owner',
  })
})

test('old local learning records still require explicit ownership consent before mobile login', async ({ page }) => {
  await harness(page)
  await page.evaluate(async () => (window as any).__backupHarness.seed())
  let calls = 0
  await page.route('**/api/auth/**', (route) => {
    calls++
    return route.abort()
  })
  await page.goto('/mobile/account')
  await expect(page.getByRole('button', { name: '确认归属并建立隔离工作区' })).toBeDisabled()
  await expect(account(page)).toHaveCount(0)
  expect(calls).toBe(0)
})
