import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * HARD single-active-session E2E: three real browser profiles independently
 * learn while offline, then reconnect together. Only the LAST valid token
 * may use cloud until the other devices explicitly reauthenticate.
 *
 * Reauth is permissible; manual Sync, direct merge APIs, test writes to
 * IndexedDB or forced page reloads to trigger sync are NOT.
 *
 * Fails until complete automatic full-V4 local adoption & writeback works.
 */
const base = process.env.QWERTY_SYNC_BASE_URL ?? ''
const expectedOrigin = 'https://t.smhe.cn'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Event = { id: number; attemptId: string; dict: string; word: string; timeStamp: number }

async function records(page: Page): Promise<Event[]> {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      request.onsuccess = () => ok(request.result)
      request.onerror = () => fail(request.error)
    })
    try {
      const req = db.transaction('wordRecords', 'readonly')
        .objectStore('wordRecords').getAll()
      return await new Promise<Event[]>((ok, fail) => {
        req.onsuccess = () => ok(req.result as Event[])
        req.onerror = () => fail(req.error)
      })
    } finally { db.close() }
  })
}
async function api(path: string, method: string, input: object, token?: string) {
  const response = await fetch(new URL(path, base), {
    method, redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(40_000),
  })
  return { status: response.status, body: await response.json() }
}
async function openAccount(page: Page, username: string, password: string) {
  await page.goto(new URL('/?s1-account=manage', base).href,
    { waitUntil: 'domcontentloaded' })
  const dialog = page.locator('[data-account]')
  await expect(dialog).toBeVisible({ timeout: 55_000 })
  const reauthToggle = page.getByRole('button', { name: '重新验证登录', exact: true })
  if (await reauthToggle.isVisible().catch(() => false)) await reauthToggle.click()
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('账户密码', { exact: true }).fill(password)
  page.on('dialog', d => d.accept())
  const reauth = page.getByRole('button', { name: '确认重新登录', exact: true })
  const signIn = page.getByRole('button', { name: '登录', exact: true })
  const previousUrl = page.url()
  const authStatuses: string[] = []
  // Status only: avoid exposing user identity, token or response bodies.
  const onAuthResponse = (response: import('@playwright/test').Response) => {
    try {
      const path = new URL(response.url()).pathname
      if (path === '/api/auth/login' || path === '/api/auth/register') {
        authStatuses.push(path + ':HTTP-' + response.status())
      }
    } catch { /* Ignore unrelated navigation */ }
  }
  page.on('response', onAuthResponse)
  try {
    // A staging-only disposable test account may retry ONE explicit HTTP 500.
    // No retry for timeouts/unknown POST outcomes or a successful auth,
    // which could otherwise revoke a valid single-active session.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = page.waitForResponse(r => {
        try { return new URL(r.url()).pathname === '/api/auth/login' }
        catch { return false }
      }, { timeout: 45_000 })
      if (await reauth.isVisible().catch(() => false)) await reauth.click()
      else await signIn.click()
      const status = (await response).status()
      if (status === 500 && attempt === 0 && page.url() === previousUrl) {
        console.log('E2E_AUTH_TRANSIENT_RETRY', JSON.stringify({
          status, attempt: attempt + 1,
        }))
        await expect(page.locator('[role="status"]')).toContainText(
          '暂时无法完成认证', { timeout: 15_000 })
        await page.waitForTimeout(2_500)
        continue
      }
      expect(status, 'explicit login HTTP status').toBe(200)
      break
    }
    // S1 is a PRE-MOUNT account transaction: it must finish and replace
    // the document before the new auth state can be inspected reliably.
    await expect(page).not.toHaveURL(previousUrl, { timeout: 60_000 })
    await expect.poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem('qwerty.cloudAuth.v1')
      const item = raw ? JSON.parse(raw) : null
      return item?.user?.username ?? null
    }).catch(() => null), { timeout: 60_000 }).toBe(username)
    await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
  } catch (error) {
    // Redact credentials; keep only the public navigational failure
    // evidence. Do not retry an uncertain S1 ownership transition.
    console.error('S1 relay login checkpoint failed', {
      path: new URL(page.url()).pathname,
      authStatuses,
      hasLoginDialog: await dialog.isVisible().catch(() => false),
      status: (await page.locator('[role="status"]').allTextContents()
        .catch(() => [])).slice(0, 3).map(x => x.slice(0, 120)),
    })
    throw error
  } finally {
    page.off('response', onAuthResponse)
  }
}
async function beginLearn(page: Page) {
  await page.goto(new URL('/learn', base).href, { waitUntil: 'domcontentloaded' })
  const start = page.getByRole('button', { name: '开始 Learn', exact: true })
  await expect(start).toBeVisible({ timeout: 35_000 })
  await start.click()
  const word = page.locator('[data-typing-word]').first()
  await expect(word).toBeVisible({ timeout: 35_000 })
  const spelling = await word.getAttribute('data-typing-word')
  expect(spelling).toBeTruthy()
  return spelling!
}
async function study(page: Page, spelling: string): Promise<Event> {
  const seen = new Set((await records(page)).map(r => r.attemptId))
  if (await page.getByText('按任意键开始').isVisible().catch(() => false)) {
    await page.keyboard.press('a')
  }
  await page.keyboard.type(spelling)
  let added: Event | undefined
  await expect.poll(async () => {
    added = (await records(page)).find(r => r.attemptId && !seen.has(r.attemptId))
    return added?.attemptId ?? null
  }, { timeout: 50_000 }).not.toBeNull()
  expect(added?.attemptId).toMatch(uuid)
  return added!
}
async function authStatus(page: Page) {
  return page.evaluate(async () => {
    const raw = localStorage.getItem('qwerty.cloudAuth.v1')
    const token = raw ? JSON.parse(raw)?.token : null
    if (!token) return { status: 0, error: 'no-token' }
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
    })
    const body = await res.json()
    return { status: res.status, error: body.error || null }
  })
}
async function assertDurable(page: Page, event: Event) {
  const rows = (await records(page)).filter(x => x.attemptId === event.attemptId)
  expect(rows).toHaveLength(1)
  expect(rows[0].dict).toBe(event.dict)
  expect(rows[0].word).toBe(event.word)
  expect(rows[0].timeStamp).toBe(event.timeStamp)
}

test('A/B/C sequential login, offline forks, reconnect, reauth and no-click V4 adoption', async ({ browser }) => {
  test.setTimeout(700_000)
  expect(process.env.GITHUB_REF_NAME).toBe('edgeone-test')
  expect(new URL(base).origin).toBe(expectedOrigin)
  expect(process.env.GITHUB_RUN_ID).toMatch(/^\d+$/)
  const username = 'e2e_fork_' + process.env.GITHUB_RUN_ID + '_' +
    (process.env.GITHUB_RUN_ATTEMPT || '1')
  const password = 'E2E-' + crypto.randomUUID() + '-test'
  const contexts: BrowserContext[] = []
  const profilePages: Page[] = []
  let userId: string | undefined
  try {
    const newAccount = await api('/api/auth/register', 'POST', {
      username, password, deviceId: 'qwerty-web-' + crypto.randomUUID(),
    })
    expect(newAccount.status).toBe(201)
    userId = newAccount.body.user?.userId
    expect(userId).toBeTruthy()
    const pages: Page[] = []
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ serviceWorkers: 'block' })
      contexts.push(ctx)
      const page = await ctx.newPage()
      pages.push(page)
      profilePages.push(page)
    }
    // Production policy: signing in on B invalidates A; signing in on C
    // invalidates B. Each learns while OFFLINE with its own durable RecordDB.
    const health = await pages[0].request.get(new URL('/api/health', base).href)
    expect((await health.json()).authMode).toBe('single-active-session')
    const branches: Event[] = []
    for (let i = 0; i < pages.length; i++) {
      await openAccount(pages[i], username, password)
      const spelling = await beginLearn(pages[i])
      await contexts[i].setOffline(true)
      branches.push(await study(pages[i], spelling))
      await assertDurable(pages[i], branches[i])
    }
    expect(new Set(branches.map(x => x.attemptId)).size).toBe(3)
    // All three reconnect simultaneously, but only C has a valid cloud
    // session. Revoked A/B MUST NOT upload or erase their local branches.
    await Promise.all(contexts.map(ctx => ctx.setOffline(false)))
    for (let i = 0; i < 2; i++) {
      await expect.poll(async () => (await authStatus(pages[i])).error,
        { timeout: 25_000 }).toBe('session_revoked')
      await assertDurable(pages[i], branches[i])
    }
    expect((await authStatus(pages[2])).status).toBe(200)

    // From here onward the ONLY permitted user action is to reauthenticate
    // the old session when it needs cloud access. No manual Sync is clicked.
    const expected = branches.map(r => r.attemptId).sort()
    for (const i of [0, 1, 2, 0, 1, 2]) {
      await openAccount(pages[i], username, password)
      await expect.poll(async () => (await authStatus(pages[i])).status,
        { timeout: 20_000 }).toBe(200)
      // The last relogin must see the complete preserved event union.
      if (i === 2) {
        await expect.poll(async () => {
          // Background S1-preboot adoption deliberately replaces the document.
          // A transient destroyed JS context is not a data result; retry
          // the READ-ONLY poll after navigation, retaining the strict 3/3 gate.
          const rows = await records(pages[i]).catch(() => [])
          return rows.filter(r => expected.includes(r.attemptId))
            .map(r => r.attemptId).sort()
        }, {
          timeout: 150_000,
          message: 'full-V4 automatic convergence after single-session handoff',
        }).toEqual(expected)
      }
      await assertDurable(pages[i], branches[i])
    }
    // Every previously reauthenticated device must retain its own WordRecord.
    // Sync completion is only proven by the exact full union on the final
    // active client; a server M3 event witness alone cannot pass this test.
    for (let i = 0; i < pages.length; i++) {
      await assertDurable(pages[i], branches[i])
    }
    console.log('PASS: single-session three offline forks auto-merged after staged reauth')
  } finally {
    const diagnostic = await Promise.all(profilePages.map(async (page, index) => {
      const rows = await records(page).catch(() => [])
      // Production build drops console calls. Read ONLY the explicitly
      // redacted etest session diagnostic; never read auth or learning data.
      const phases = await page.evaluate(() => {
        const raw = sessionStorage.getItem('qwerty.etest.m4.stageTrace.v1')
        const entries: unknown = raw ? JSON.parse(raw) : []
        if (!Array.isArray(entries)) return []
        const allowed = /^[a-z][a-z0-9-]{0,63}$/
        return entries.slice(-48).map(item => {
          if (!item || typeof item !== 'object') return null
          const safe: Record<string, string | number | boolean> = {}
          for (const [name, value] of Object.entries(item)) {
            if (!allowed.test(name)) continue
            if (typeof value === 'string' && allowed.test(value)) safe[name] = value
            else if (typeof value === 'number' && Number.isSafeInteger(value) &&
              value >= 0 && value <= 100000) safe[name] = value
            else if (typeof value === 'boolean') safe[name] = value
          }
          return safe
        }).filter(Boolean)
      }).catch(() => [])
      return { index, localRows: rows.length, witnessPhases: phases }
    }))
    console.log('E2E_M4_THREE_DEVICE_COUNTS', JSON.stringify(diagnostic))
    await Promise.allSettled(contexts.map(ctx => ctx.close()))
    if (userId) {
      expect(username).toMatch(/^e2e_fork_\d+_\d+$/)
      const fresh = await api('/api/auth/login', 'POST', {
        username, password, deviceId: 'qwerty-web-' + crypto.randomUUID(),
      })
      expect(fresh.status).toBe(200)
      expect(fresh.body.user?.userId).toBe(userId)
      const removed = await api('/api/auth/account', 'DELETE',
        { currentPassword: password }, fresh.body.token)
      expect(removed.status).toBe(200)
      expect(removed.body.deleted?.accountDeleted).toBe(true)
    }
  }
})
