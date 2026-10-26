import { expect, test, type Page } from '@playwright/test'

async function harness(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness?.seed))).toBe(true)
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile direct account' : 'desktop direct account', () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 } })
    for (const mode of ['native', 'fallback']) {
      for (const authState of ['anonymous', 'valid', 'expired']) {
        test(mode + ' ' + authState + ' replaces the writer document and preserves records', async ({ page, context }) => {
          await context.addInitScript((mode) => {
            // Keep navigation/ownership independent of cloud preflights.
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
            if (mode === 'fallback') Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
          }, mode)
          const authRequests: { method: string; path: string }[] = []
          page.on('request', (request) => {
            const path = new URL(request.url()).pathname
            if (path.startsWith('/api/auth/')) authRequests.push({ method: request.method(), path })
          })
          await page.route('**/api/auth/me', (route) =>
            route.fulfill({
              json: {
                ok: true,
                user: { userId: 'direct-entry-owner', username: 'direct-entry-user' },
              },
            }),
          )
          await harness(page)
          const before = await page.evaluate(async (authState) => {
            const h = (window as any).__backupHarness
            await h.seed()
            const signedIn = authState !== 'anonymous'
            if (signedIn)
              localStorage.setItem(
                'qwerty.cloudAuth.v1',
                JSON.stringify({
                  token: 'direct-entry-fixture',
                  expiresAt: Math.floor(Date.now() / 1000) + (authState === 'expired' ? -60 : 3600),
                  user: { userId: 'direct-entry-owner', username: 'direct-entry-user' },
                }),
              )
            await h.initializeLegacyWorkspace(signedIn ? { kind: 'account', accountId: 'direct-entry-owner' } : h.ANONYMOUS)
            return {
              rows: await h.db.wordRecords.toArray(),
              registry: await h.workspaceRegistryPort.read(),
              auth: localStorage.getItem('qwerty.cloudAuth.v1'),
            }
          }, authState)
          await page.goto(mobile ? '/mobile' : '/learn')
          const entry = page.locator(mobile ? '[data-mobile-account-entry]' : '[data-account-entry]')
          await expect(entry).toBeVisible({ timeout: 30_000 })
          const previous = await page.evaluate(() => ({ origin: performance.timeOrigin, history: history.length }))
          await entry.focus()
          await page.keyboard.press('Enter')
          await expect(page.locator(mobile ? '[data-mobile-account]' : '[data-desktop-account]')).toBeVisible()
          await expect(page).toHaveURL(mobile ? /\/mobile\/account$/ : /\/\?s1-account=manage$/)
          await expect(page.locator('[data-account-overview], [data-account-tools]')).toHaveCount(0)
          expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(previous.origin)
          expect(await page.evaluate(() => history.length)).toBe(previous.history)
          await expect(page.getByRole('heading', { name: authState === 'anonymous' ? '登录 QWERTY Plus' : '我的账号' })).toBeVisible()
          if (authState === 'valid') await expect(page.getByLabel('账户密码', { exact: true })).toBeHidden()
          else await expect(page.getByLabel('账户密码', { exact: true })).toBeVisible()
          if (authState === 'expired') await expect(page.getByText('登录已过期 · 本机学习记录仍保留', { exact: true })).toBeVisible()
          const contender = await context.newPage()
          await harness(contender)
          expect(
            await contender.evaluate(async () => {
              try {
                const lease = await (window as any).__backupHarness.acquireWorkspaceWriterLease()
                lease.release()
                return 'stolen'
              } catch {
                return 'blocked'
              }
            }),
          ).toBe('blocked')
          await contender.close()
          await page.reload()
          await expect(page.locator('[data-account]')).toBeVisible()
          await page.getByRole('button', { name: '返回', exact: true }).click()
          await expect(page.locator(mobile ? '[data-mobile-menu]' : '[data-account-entry]')).toBeVisible({ timeout: 30_000 })
          // The mounted learning app retains its existing read-only session
          // validation. Opening/returning must never submit authentication.
          expect(authRequests.every((request) => request.method === 'GET' && request.path === '/api/auth/me')).toBe(true)
          await harness(page)
          const after = await page.evaluate(async () => {
            const h = (window as any).__backupHarness
            return {
              rows: await h.db.wordRecords.toArray(),
              registry: await h.workspaceRegistryPort.read(),
              auth: localStorage.getItem('qwerty.cloudAuth.v1'),
            }
          })
          expect(after.rows).toEqual(before.rows)
          expect(after.registry.active).toEqual(before.registry.active)
          expect(after.registry.generation).toBe(before.registry.generation)
          expect(after.registry.pending).toBeNull()
          expect(after.auth).toBe(before.auth)
        })
      }
    }
  })
}

test('responsive home and data navigation keep the document and learning history', async ({ page }) => {
  await harness(page)
  const before = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    await h.initializeLegacyWorkspace(h.ANONYMOUS)
    return await h.db.wordRecords.toArray()
  })
  await page.goto('/learn')
  await expect(page.locator('[data-account-entry]')).toBeVisible()
  const origin = await page.evaluate(() => performance.timeOrigin)
  await page.setViewportSize({ width: 500, height: 800 })
  await expect(page).toHaveURL(/\/mobile$/)
  await page.getByRole('link', { name: /账号与云同步/ }).click()
  await expect(page.locator('[data-mobile-data]')).toBeVisible()
  await page.getByRole('link', { name: '返回首页', exact: true }).click()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page).toHaveURL(/\/learn$/)
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await harness(page)
  expect(await page.evaluate(() => (window as any).__backupHarness.db.wordRecords.toArray())).toEqual(before)
})

for (const mobile of [true, false]) {
  test((mobile ? 'mobile' : 'desktop') + ' cloud tools remain an explicit secondary entry without account switching', async ({ page }) => {
    await harness(page)
    await page.evaluate(async () => {
      const h = (window as any).__backupHarness
      await h.seed()
      localStorage.setItem(
        'qwerty.cloudAuth.v1',
        JSON.stringify({
          token: 'tools-fixture',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: { userId: 'tools-owner', username: 'tools-user' },
        }),
      )
      await h.initializeLegacyWorkspace({ kind: 'account', accountId: 'tools-owner' })
    })
    let toolsRequests = 0
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/account-policy')) toolsRequests++
      if (path === '/api/auth/me') return route.fulfill({ json: { ok: true, user: { userId: 'tools-owner', username: 'tools-user' } } })
      return route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith('/access') ? { administrator: true } : { enabled: true },
      })
    })
    await page.goto(mobile ? '/mobile/data' : '/learn?account-tools-test=1')
    if (!mobile) {
      await page.getByRole('button', { name: '打开设置对话框' }).click()
      await page.getByRole('tab', { name: '数据与备份' }).click()
    }
    await page.getByText('更多同步选项', { exact: true }).click()
    await expect(page.getByRole('button', { name: '云端账号工具', exact: true })).toBeVisible()
    const origin = await page.evaluate(() => performance.timeOrigin)
    expect(toolsRequests).toBe(0)
    await page.getByRole('button', { name: '云端账号工具', exact: true }).click()
    await expect(page.locator('[data-account-tools]')).toBeVisible()
    await page.getByText('管理工具', { exact: true }).click()
    await page.getByRole('button', { name: '预览清理名单' }).focus()
    await expect(page.getByRole('button', { name: '预览清理名单' })).toBeFocused()
    await expect(page.getByRole('button', { name: '预览清理名单' })).toBeVisible()
    await expect(page.getByRole('button', { name: '登录与账号管理' })).toHaveCount(0)
    await page.getByRole('button', { name: '关闭账号工具', exact: true }).click()
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
    await expect(page.locator(mobile ? '[data-mobile-data]' : '.focus-settings-dialog')).toBeVisible()
  })
}

for (const role of ['ordinary', 'failed', 'malformed', 'expired', 'anonymous']) {
  test(role + ' cannot see or open administrator tools', async ({ page }) => {
    await harness(page)
    await page.evaluate(async (role) => {
      const h = (window as any).__backupHarness
      await h.seed()
      if (role !== 'anonymous')
        localStorage.setItem(
          'qwerty.cloudAuth.v1',
          JSON.stringify({
            token: 'ordinary-fixture',
            expiresAt: Math.floor(Date.now() / 1000) + (role === 'expired' ? -60 : 3600),
            user: { userId: 'ordinary-owner', username: 'ordinary-user' },
          }),
        )
      await h.initializeLegacyWorkspace(role === 'anonymous' ? h.ANONYMOUS : { kind: 'account', accountId: 'ordinary-owner' })
    }, role)
    let policyRequests = 0
    let accessRequests = 0
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/admin/access') {
        accessRequests++
        if (role === 'failed') return route.fulfill({ status: 503, json: { error: 'unavailable' } })
        return route.fulfill({ json: { administrator: role === 'malformed' ? 'true' : false } })
      }
      if (path === '/api/account-policy') policyRequests++
      return route.fulfill({ json: { ok: true, user: { userId: 'ordinary-owner', username: 'ordinary-user' }, enabled: true } })
    })
    await page.goto('/mobile/data')
    await expect(page.locator('[data-mobile-data]')).toBeVisible()
    await page.getByText('更多同步选项', { exact: true }).click()
    if (!['expired', 'anonymous'].includes(role)) await expect.poll(() => accessRequests).toBe(1)
    await expect(page.getByRole('button', { name: '云端账号工具', exact: true })).toHaveCount(0)
    // Even a stale/programmatic open event must not mount a normal-user dialog.
    await page.addScriptTag({
      type: 'module',
      content: `
      import { openAccountDialog, isAccountDialogOpen } from '/src/sync/account-dialog-events.ts';
      window.__accountToolsOpen = isAccountDialogOpen;
      window.__accountToolsFlashed = false;
      new MutationObserver(() => { if (document.querySelector('[data-account-tools]')) window.__accountToolsFlashed = true }).observe(document.body, { childList: true, subtree: true });
      openAccountDialog();
    `,
    })
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).__accountToolsOpen === 'function' && !(window as any).__accountToolsOpen()))
      .toBe(true)
    await expect(page.locator('[data-account-tools]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__accountToolsFlashed)).toBe(false)
    expect(policyRequests).toBe(0)
    if (['expired', 'anonymous'].includes(role)) expect(accessRequests).toBe(0)
    await page.getByRole('button', { name: '管理账号', exact: true }).click()
    await expect(page.locator('[data-mobile-account]')).toBeVisible()
    await expect(page.locator('[data-account-tools], [data-account-overview]')).toHaveCount(0)
  })
}
