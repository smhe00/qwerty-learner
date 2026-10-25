import { loadBodyPolicy } from './body-policy-loader'
import { acknowledgeInformationDialog } from './information-dialog'
import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'

/** Exactly one disposable account; tested runtime pinned by CI and page probe. */
const base = 'https://t.smhe.cn'
const expected = 'b927b31ac2b4750774163b50ae8b961f36d33509'
const PATH = '/api'

async function api(path: string, method: string, body?: object, token?: string) {
  const { retrySafeBodyRequest } = await loadBodyPolicy()
  return retrySafeBodyRequest(async () => {
    const response = await fetch(base + PATH + path, {
      method, redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(40_000),
    })
    return { status: response.status, body: await response.json() }
  }, { method, path: PATH + path })
}

test('one-click manual Sync: PC hovered account menu and mobile home', async ({ browser }) => {
  test.setTimeout(360_000)
  // Do not create any account before verifying the actual deployed source.
  let deployed = false
  for (let attempt = 0; attempt < 48; attempt++) {
    const marker = await fetch(base + '/source-commit.txt?quick-ui=' + attempt, {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000),
    }).then(async r => r.ok ? (await r.text()).trim() : '').catch(() => '')
    if (marker && /^([0-9a-f]{7,40})$/.test(marker) && expected.startsWith(marker)) {
      deployed = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  expect(deployed, 'Only verify the exact pinned E-test site').toBe(true)

  const username = 'qui26' + randomBytes(10).toString('hex')
  const password = 'QW' + randomBytes(13).toString('hex')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
  const page = await ctx.newPage()
  let created = false
  let loginStatus = 0
  let desktop = false, mobile = false, cleanup = false
  try {
    const registered = await api('/auth/register', 'POST', {
      username, password, deviceId: 'qwerty-ui-' + randomUUID(),
    })
    expect(registered.status).toBe(201)
    created = true
    await page.goto(base + '/?s1-account=manage', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-account]')).toBeVisible({ timeout: 60_000 })
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('账户密码', { exact: true }).fill(password)
    page.on('dialog', dialog => { void dialog.accept() })
    const authResponse = page.waitForResponse(resp =>
      new URL(resp.url()).pathname === '/api/auth/login' && resp.status() !== 503, { timeout: 70_000 })
    await page.getByRole('button', { name: '登录', exact: true }).click()
    loginStatus = (await authResponse).status()
    expect(loginStatus).toBe(200)
    await expect(page).toHaveURL(/^https:\/\/t\.smhe\.cn\/(?:learn)?$/, { timeout: 120_000 })
    await acknowledgeInformationDialog(page)
    const trigger = page.locator('[data-account-entry]')
    await expect(trigger).toBeVisible({ timeout: 45_000 })
    await expect(trigger).toContainText(username)
    await trigger.hover()
    const menu = page.locator('[data-account-menu]')
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await expect(menu.getByRole('menuitem', { name: '账号管理' })).toBeVisible()
    await expect(menu.locator('[data-quick-sync-entry]')).toBeVisible()
    // No extra confirmation click: the entry starts the existing guarded sync.
    await menu.locator('[data-quick-sync-entry]').click()
    await expect(page.locator('[data-quick-sync-result="ok"]')).toBeVisible({ timeout: 120_000 })
    await expect(page).toHaveURL(/^https:\/\/t\.smhe\.cn\/learn$/, { timeout: 45_000 })
    desktop = true

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(base + '/mobile', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-mobile-account-entry]')).toBeVisible({ timeout: 60_000 })
    const mobileButton = page.locator('.mobile-brand [data-quick-sync-entry]')
    await expect(mobileButton).toBeVisible()
    await expect(mobileButton).toHaveAttribute('aria-label', '立即同步学习记录')
    await mobileButton.click()
    await expect(page.locator('[data-quick-sync-result="ok"]')).toBeVisible({ timeout: 120_000 })
    await expect(page).toHaveURL(/^https:\/\/t\.smhe\.cn\/mobile$/, { timeout: 45_000 })
    mobile = true
  } finally {
    // A later login invalidates the browser token; tests have finished.
    // Do not log names, passwords, tokens or any cloud backup.
    await ctx.close()
    if (created) {
      const fresh = await api('/auth/login', 'POST', {
        username, password, deviceId: 'qwerty-ui-cleanup-' + randomUUID(),
      }).catch(() => null)
      if (fresh?.status === 200 && typeof fresh.body?.token === 'string') {
        const removed = await api('/auth/account', 'DELETE', { currentPassword: password }, fresh.body.token).catch(() => null)
        cleanup = removed?.status === 200 && removed.body?.deleted?.accountDeleted === true
      }
    }
    console.log('QUICK_UI_RESULTS ' + JSON.stringify({
      sourceMatch: deployed, loginHttp200: loginStatus === 200,
      pcHoveredAndSynced: desktop, mobileHomeSynced: mobile,
      knownDisposableAccountDeleted: cleanup,
    }))
  }
  expect(cleanup, 'The single test account must be deleted/verified').toBe(true)
})
