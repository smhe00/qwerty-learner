import { expect, test } from '@playwright/test'

test.use({ isMobile: true, hasTouch: true })
for (const [width, height, theme] of [
  [360, 640, 'light'],
  [390, 844, 'dark'],
] as const) {
  test(`mobile clarity: concise login and registration on ${width}px ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: theme })
    let authCalls = 0
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/auth/')) authCalls++
    })
    await page.goto('/mobile/account')
    const panel = page.getByRole('dialog')
    await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
    const text = await panel.innerText()
    expect(text).not.toMatch(/SMHE|管理员|工作区|持久化|事务|S1|V4|YOUR LEARNING SPACE|闲置清理/)
    const login = page.getByRole('button', { name: '登录', exact: true })
    const rect = await login.boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`mobile-login-${width}-${theme}.png`), fullPage: true })
    await page.getByRole('tab', { name: '注册', exact: true }).tap()
    await expect(page.getByRole('heading', { name: '注册 QWERTY Plus' })).toBeVisible()
    await expect(page.getByLabel('注册密码确认')).toBeVisible()
    await expect(page.getByRole('complementary', { name: '注册须知' })).toContainText('暂不支持账号找回')
    await expect(page.getByText(/连续 180 天/)).toBeHidden()
    await page.getByText('账号保留规则', { exact: true }).tap()
    await expect(page.getByText(/连续 180 天/)).toBeVisible()
    await page.getByText('账号保留规则', { exact: true }).tap()
    await page.screenshot({ path: info.outputPath(`mobile-register-${width}-${theme}.png`), fullPage: true })
    await page.getByRole('tab', { name: '登录', exact: true }).tap()
    await expect(page.getByLabel('注册密码确认')).toBeHidden()
    expect(authCalls).toBe(0)
  })
}

test('mobile clarity: password editor and re-login are exclusive and preserve saved learning', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
  await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.setItem(
      'qwerty.cloudAuth.v1',
      JSON.stringify({
        token: 'fixture-token',
        expiresAt: Date.now() / 1000 + 3600,
        user: { userId: 'clarity-owner', username: 'clarity-user' },
      }),
    )
    await h.initializeLegacyWorkspace({ kind: 'account', accountId: 'clarity-owner' })
  })
  await page.goto('/mobile/account')
  await expect(page.getByRole('heading', { name: '我的账号' })).toBeVisible()
  const rows = () =>
    page.evaluate(async () => {
      const q = indexedDB.open('RecordDB')
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        q.onsuccess = () => ok(q.result)
        q.onerror = () => fail(q.error)
      })
      try {
        return await new Promise((ok, fail) => {
          const r = db.transaction('wordRecords').objectStore('wordRecords').getAll()
          r.onsuccess = () => ok(r.result)
          r.onerror = () => fail(r.error)
        })
      } finally {
        db.close()
      }
    })
  const original = await rows()
  let authCalls = 0
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/auth/')) authCalls++
  })
  await page.getByRole('button', { name: '修改密码', exact: true }).tap()
  await expect(page.getByLabel('当前密码', { exact: true })).toBeVisible()
  await expect(page.getByLabel('账户密码', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '重新验证登录', exact: true })).toBeHidden()
  await page.goto('/mobile/account?s1-reauth=1')
  await expect(page.getByLabel('账户密码', { exact: true })).toBeVisible()
  await expect(page.getByLabel('当前密码', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: '修改密码', exact: true }).tap()
  await expect(page.getByLabel('当前密码', { exact: true })).toBeVisible()
  await expect(page.getByLabel('账户密码', { exact: true })).toBeHidden()
  expect(await rows()).toEqual(original)
  expect(authCalls).toBe(0)
})
