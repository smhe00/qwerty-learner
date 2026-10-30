import { type Page, type Request, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { acknowledgeInformationDialog } from './information-dialog'

const origin = 'https://t.smhe.cn'
const owner = { kind: 'account' as const, accountId: 'passive-return-local-only' }
const user = { userId: owner.accountId, username: 'synthetic' }
const emptyMeta = {
  ok: true,
  hasData: false,
  revision: 0,
  updatedAt: null,
  sizeBytes: 0,
  logicalFingerprint: null,
  payloadSha256: null,
  clientFormatVersion: null,
}
function committedMeta(request: Request) {
  const bytes = request.postDataBuffer()!,
    headers = request.headers()
  const sha = createHash('sha256').update(bytes).digest('hex')
  expect(headers['x-qwerty-payload-sha256']).toBe(sha)
  return {
    ...emptyMeta,
    hasData: true,
    revision: Number(headers['x-qwerty-base-revision']) + 1,
    storageEncoding: 'binary',
    sizeBytes: bytes.length,
    payloadSha256: sha,
    logicalFingerprint: headers['x-qwerty-logical-fingerprint'],
    clientFormatVersion: 'qwerty-backup-v4',
  }
}
async function setup(page: Page, baseURL: string) {
  const sync: string[] = [],
    auth: string[] = []
  let meta: any = emptyMeta,
    loginFails = false
  // Every resource stays local; no real etest API, account or cloud write.
  await page.route(origin + '/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    if (path.startsWith('/api/')) {
      if (path.startsWith('/api/sync/')) sync.push(request.method() + ' ' + path)
      if (path.startsWith('/api/auth/')) auth.push(request.method() + ' ' + path)
      if (path === '/api/auth/me') return route.fulfill({ json: { ok: true, user } })
      if (path === '/api/auth/login')
        return loginFails
          ? route.fulfill({ status: 401, json: { ok: false, error: 'incorrect_password' } })
          : route.fulfill({
              json: { ok: true, user, token: 'synthetic-rotated-local-only', expiresAt: Math.floor(Date.now() / 1000) + 3600 },
            })
      if (path === '/api/admin/access') return route.fulfill({ json: { ok: true, administrator: false } })
      if (path === '/api/sync/v2/meta') return route.fulfill({ json: meta })
      if (path === '/api/sync/v2/binary/direct') {
        meta = committedMeta(request)
        return route.fulfill({ json: meta })
      }
      if (path === '/api/sync/events/v2/observed')
        return route.fulfill({
          json: {
            ok: true,
            observed: [],
            observedCount: 0,
            visibleForks: [],
            visibleGaps: [],
            truncated: false,
            listingIsAuthoritative: false,
            convergenceComplete: false,
          },
        })
      return route.abort('failed')
    }
    const response = await page.request.get(new URL(path + url.search, baseURL).href)
    return route.fulfill({ response })
  })
  await page.goto(origin + '/tests/e2e/startup-sync-regression.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness))).toBe(true)
  const rows = await page.evaluate(
    async ({ owner, user }) => {
      const h = (window as any).__backupHarness
      await h.seed()
      localStorage.setItem(
        'qwerty.cloudAuth.v1',
        JSON.stringify({ token: 'synthetic-local-only', expiresAt: Math.floor(Date.now() / 1000) + 3600, user }),
      )
      await h.initializeLegacyWorkspace(owner)
      return h.db.wordRecords.toArray()
    },
    { owner, user },
  )
  return {
    sync,
    auth,
    rows,
    failLogin: () => {
      loginFails = true
    },
  }
}
async function learning(page: Page, mobile: boolean) {
  await expect(page.locator(mobile ? '[data-mobile-account-entry]' : '[data-account-entry]')).toBeVisible({ timeout: 30000 })
  const info = page.locator('dialog.safety-information-dialog[open]')
  if (await info.isVisible()) await info.getByRole('button', { name: '知道了' }).click()
}
async function account(page: Page, mobile: boolean) {
  await page.locator(mobile ? '[data-mobile-account-entry]' : '[data-account-entry]').click()
  await expect(page.locator('[data-account]')).toBeVisible()
}
for (const mobile of [false, true]) {
  test(
    (mobile ? 'mobile' : 'desktop') + ' passive account return performs no sync, retains session validation and consumes ticket once',
    async ({ page, baseURL }) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
      const state = await setup(page, baseURL!)
      await page.goto(origin + (mobile ? '/mobile' : '/'))
      await learning(page, mobile)
      expect(state.sync).toContain('GET /api/sync/v2/meta')
      await account(page, mobile)
      state.sync.length = 0
      state.auth.length = 0
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await learning(page, mobile)
      // Cross the old 2s immediate drain boundary without reaching the retained 45s idle scan.
      await page.waitForTimeout(3000)
      expect(state.sync).toEqual([])
      expect(state.auth).toContain('GET /api/auth/me')
      expect(state.auth.every((x) => x === 'GET /api/auth/me')).toBe(true)
      expect(await page.evaluate(() => sessionStorage.getItem('qwerty.account-visit.v1'))).toBeNull()
      await page.reload()
      await learning(page, mobile)
      expect(state.sync).toContain('GET /api/sync/v2/meta')
      await page.goto(origin + '/tests/e2e/startup-sync-regression.html')
      await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness))).toBe(true)
      expect(await page.evaluate(() => (window as any).__backupHarness.db.wordRecords.toArray())).toEqual(state.rows)
    },
  )
}
for (const fails of [false, true]) {
  test((fails ? 'failed' : 'successful') + ' reauthentication never takes passive return shortcut', async ({ page, baseURL }) => {
    const state = await setup(page, baseURL!)
    await page.goto(origin + '/')
    await learning(page, false)
    await account(page, false)
    if (fails) state.failLogin()
    // Healthy accounts do not advertise redundant reauthentication. Enter
    // the same explicit required-reauth mode used by an expired session.
    await expect(page.getByRole('button', { name: '重新验证登录', exact: true })).toHaveCount(0)
    await page.goto(origin + '/?s1-account=manage&s1-reauth=1')
    await page.getByLabel('账户密码', { exact: true }).fill('synthetic-password')
    state.sync.length = 0
    await page.getByRole('button', { name: '确认重新登录', exact: true }).click()
    if (fails) {
      await expect(page.getByRole('status')).toContainText('本机学习记录仍保留')
      await page.getByRole('button', { name: '返回', exact: true }).click()
    }
    await learning(page, false)
    expect(state.auth).toContain('POST /api/auth/login')
    expect(state.sync).toContain('GET /api/sync/v2/meta')
    expect(await page.evaluate(() => sessionStorage.getItem('qwerty.account-visit.v1'))).toBeNull()
  })
}


test('full network budget on Learn navigation still mounts preserved local data before the bounded UI deadline', async ({ page, baseURL }) => {
  test.setTimeout(120_000) // Includes fixture setup, the real60s product budget, and final independent DB read.
  const state = await setup(page, baseURL!)
  await page.goto(origin + '/')
  await learning(page, false)
  let reads = 0, writes = 0
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes++
  })
  await page.route(origin + '/api/sync/v2/meta', async route => {
    reads++
    await new Promise(resolve => setTimeout(resolve, 65_000))
    await route.fulfill({ json: emptyMeta }).catch(() => {})
  })
  const started = Date.now()
  await page.goto(origin + '/learn', { waitUntil: 'domcontentloaded' })
  // This same helper is used by the real three-device beginLearn flow.
  // Its former60s default fails before the product finishes safe local startup.
  await acknowledgeInformationDialog(page)
  const mountedMs = Date.now() - started
  const trace = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qwerty.startup-sync-trace.v1') || '[]'))
  expect(trace.at(-1).phase).toBe('finish')
  expect(trace.at(-1).remainingMs).toBe(0)
  expect(trace.at(-1).elapsedMs).toBeGreaterThanOrEqual(60_000)
  expect(reads).toBe(1)
  expect(writes).toBe(0)
  expect(mountedMs).toBeLessThan(80_000)
  await page.goto(origin + '/tests/e2e/startup-sync-regression.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__backupHarness))).toBe(true)
  expect(await page.evaluate(() => (window as any).__backupHarness.db.wordRecords.toArray())).toEqual(state.rows)
  console.log('FULL_BUDGET_LEARN_NAVIGATION', JSON.stringify({ mountedMs, reads, writes, localRows: state.rows.length }))
})
