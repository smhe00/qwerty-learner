import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page, Route } from '@playwright/test'

const OWNER = { kind: 'account' as const, accountId: 's1-revoked-immutable-user' }
const TOKEN_A = 's1-device-A-token'
const TOKEN_B = 's1-device-B-token'

class SessionServer {
  current = TOKEN_A
  overrideAuthError: { status: number; code: string } | null = null
  meChecks = 0
  readonly user = { userId: OWNER.accountId, username: 'revocation-test' }

  async route(route: Route): Promise<void> {
    const req = route.request()
    if (req.method() === 'POST' && req.url().endsWith('/api/auth/login')) {
      this.current = TOKEN_B
      await route.fulfill({
        status: 200, json: { ok: true, token: TOKEN_B,
          user: this.user, expiresAt: Math.floor(Date.now() / 1000) + 3600 },
      })
      return
    }
    if (req.url().endsWith('/api/auth/me')) {
      this.meChecks++
      if (this.overrideAuthError) {
        await route.fulfill({ status: this.overrideAuthError.status,
          json: { ok: false, error: this.overrideAuthError.code,
            message: 'not a takeover' },
        })
        return
      }
      const bearer = req.headers().authorization || ''
      if (bearer !== 'Bearer ' + this.current) {
        await route.fulfill({ status: 401, json: {
          ok: false, error: 'session_revoked', message: 'New device logged in',
        } })
        return
      }
      await route.fulfill({ json: { ok: true, user: this.user } })
      return
    }
    throw new Error('Unexpected auth route ' + req.url())
  }

  async connect(context: BrowserContext) {
    await context.route(/\/api\/auth\/(?:me|login)(?:\?|$)/, route => this.route(route))
  }
}

async function setupAccount(context: BrowserContext, token: string, seeded: boolean) {
  const page = await context.newPage()
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.initializeLegacyWorkspace))).toBe(true)
  await page.evaluate(async ({ owner, session, seed }) => {
    const h = (window as any).__backupHarness
    if (seed) await h.seed()
    else await h.clearAllTables()
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({
      token: session, expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: owner.accountId, username: 'revocation-test' },
    }))
    await h.initializeLegacyWorkspace(owner)
  }, { owner: OWNER, session: token, seed: seeded })
  return page
}

async function context(browser: Browser, server: SessionServer) {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4178',
    serviceWorkers: 'block' })
  await server.connect(ctx)
  return ctx
}

test('revoked device can reauthenticate same account without losing offline records', async ({ browser }) => {
  const server = new SessionServer()
  const a = await context(browser, server)
  const b = await context(browser, server)
  try {
    const pageA = await setupAccount(a, TOKEN_A, true)
    const pageB = await setupAccount(b, TOKEN_B, false)
    await pageA.goto('/')
    // B becomes sole valid session; the stale A must retain its IDB data.
    const signed = await pageB.evaluate(async () =>
      (await fetch('/api/auth/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'revocation-test', password: 'testing' }),
      })).json())
    expect(signed.token).toBe(TOKEN_B)
    await pageA.waitForTimeout(5500)
    await pageA.bringToFront()
    const alert = pageA.getByRole('alertdialog')
    await expect(alert).toBeVisible({ timeout: 25_000 })
    await expect(alert).toContainText('原账号的学习记录仍安全保留')
    await alert.getByRole('button', { name: '重新登录当前账号并继续' }).click()

    // S1 account reauth happens pre-mount and MUST NOT stage an
    // account-to-anonymous transaction or discard local WorkSpace V4.
    await expect(pageA).toHaveURL(/s1-account=manage/, { timeout: 25_000 })
    const manage = pageA.getByRole('dialog', { name: '安全账户管理（S1）' })
    await expect(manage).toBeVisible({ timeout: 25_000 })
    const oldOwner = await pageA.evaluate(async () => {
      const h = (window as any).__backupHarness
      return h ? (await h.workspaceRegistryPort.read()).active : null
    }).catch(() => null)
    // In the pre-mount login realm, no React/RecordDB writer is present.
    expect(oldOwner).toBeNull()
    await pageA.getByPlaceholder('用户名').fill('revocation-test')
    await pageA.getByPlaceholder('账户密码').fill('testing')
    await manage.getByRole('button', { name: '重新登录当前账户' }).click()
    await expect.poll(async () => pageA.evaluate(() => {
      const auth = localStorage.getItem('qwerty.cloudAuth.v1')
      return auth ? JSON.parse(auth).token : null
    }).catch(() => null), { timeout: 35_000 }).toBe(TOKEN_B)

    await pageA.goto('/tests/e2e/backup-harness.html')
    const after = await pageA.evaluate(async () => {
      const h = (window as any).__backupHarness
      const reg = await h.workspaceRegistryPort.read()
      const rows = await h.db.wordRecords.toArray()
      return { active: reg.active, pending: reg.pending,
        attemptWords: rows.map((row: any) => row.word),
        token: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').token }
    })
    expect(after.active).toEqual(OWNER)
    expect(after.pending).toBeNull()
    expect(after.attemptWords).toContain('backup-fsrs-word')
    expect(after.token).toBe(TOKEN_B)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

test('B login revokes A; A confirmation completes S1 durable anonymous switch', async ({ browser }) => {
  const server = new SessionServer()
  const a = await context(browser, server)
  const b = await context(browser, server)
  try {
    const pageA = await setupAccount(a, TOKEN_A, true)
    const pageB = await setupAccount(b, TOKEN_B, false)
    await pageA.goto('/')
    await expect(pageA.getByRole('alertdialog')).toHaveCount(0)
    // Actual login request from B's isolated browser context supersedes A.
    const login = await pageB.evaluate(async () => {
      const response = await fetch('/api/auth/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'revocation-test', password: 'testing' }),
      })
      return response.json()
    })
    expect(login.token).toBe(TOKEN_B)
    await pageB.goto('/')
    // Focus probes are intentionally throttled shortly after initial mount.
    await pageA.waitForTimeout(5500)
    await pageA.bringToFront()
    const alert = pageA.getByRole('alertdialog')
    await expect(alert).toBeVisible({ timeout: 25_000 })
    await expect(alert).toContainText('账号已在其他设备登录')
    // Do not interpret server-side revocation as local data deletion.
    await alert.getByRole('button',
      { name: '确认退出并切换到本机匿名工作区' }).click()
    // A confirmed S1 handoff can navigate twice: first into the guarded
    // pre-mount switch, then back to the ordinary app. Inspect the URL from
    // Playwright (outside the replaced JS realm) and allow the old realm to
    // disappear during navigation. We still require durable auth deletion
    // AND the normal application URL before accepting success.
    await expect.poll(() => {
      const url = new URL(pageA.url())
      return url.pathname === '/' &&
        !url.searchParams.has('s1-session-revoked')
    }, { timeout: 30000 }).toBe(true)
    await expect.poll(async () => {
      try {
        return await pageA.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))
      } catch (error) {
        if (error instanceof Error &&
            /Execution context was destroyed|navigation/i.test(error.message)) {
          return '__navigation_in_progress__'
        }
        throw error
      }
    }, { timeout: 30000 }).toBeNull()

    await pageA.goto('/tests/e2e/backup-harness.html')
    const recovered = await pageA.evaluate(async identity => {
      const h = (window as any).__backupHarness
      const registry = await h.workspaceRegistryPort.read()
      const old = await h.loadWorkspaceFromVault(identity)
      return {
        registry, auth: localStorage.getItem('qwerty.cloudAuth.v1'),
        oldRows: old?.workspaceData.database.data.data
          .find((table: any) => table.tableName === 'wordRecords')?.rows,
        anonymousCount: await h.db.wordRecords.count(),
      }
    }, OWNER)
    expect(recovered.registry.active).toEqual({ kind: 'anonymous' })
    expect(recovered.registry.pending).toBeNull()
    expect(recovered.auth).toBeNull()
    expect(recovered.oldRows?.some((row: any) =>
      row.word === 'backup-fsrs-word')).toBe(true)
    expect(recovered.anonymousCount).toBe(0)

    await pageB.goto('/tests/e2e/backup-harness.html')
    const surviving = await pageB.evaluate(async () => {
      const h = (window as any).__backupHarness
      return {
        registry: await h.workspaceRegistryPort.read(),
        token: JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').token,
      }
    })
    expect(surviving.registry.active).toEqual(OWNER)
    expect(surviving.token).toBe(TOKEN_B)
  } finally {
    await Promise.all([a.close(), b.close()])
  }
})

test('network 503 and session_expired never falsely force anonymous logout', async ({ browser }) => {
  const server = new SessionServer()
  const a = await context(browser, server)
  try {
    const page = await setupAccount(a, TOKEN_A, true)
    server.overrideAuthError = { status: 503, code: 'temporary_unavailable' }
    await page.goto('/')
    await expect.poll(() => server.meChecks).toBeGreaterThan(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    server.overrideAuthError = { status: 401, code: 'session_expired' }
    await page.reload()
    await expect.poll(() => server.meChecks).toBeGreaterThan(1)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.goto('/tests/e2e/backup-harness.html')
    const state = await page.evaluate(async () => {
      const h = (window as any).__backupHarness
      return { owner: (await h.workspaceRegistryPort.read()).active,
        originalRows: await h.db.wordRecords.count() }
    })
    expect(state.owner).toEqual(OWNER)
    expect(state.originalRows).toBe(1)
  } finally { await a.close() }
})

test('no confirmation handoff cannot switch account owner', async ({ browser }) => {
  const server = new SessionServer()
  const a = await context(browser, server)
  try {
    const page = await setupAccount(a, TOKEN_A, true)
    await page.goto('/?s1-session-revoked=confirm')
    await expect(page.getByText('学习数据安全检查未通过')).toBeVisible()
    await page.goto('/tests/e2e/backup-harness.html')
    const state = await page.evaluate(async () => {
      const h = (window as any).__backupHarness
      return { registry: await h.workspaceRegistryPort.read(),
        rows: await h.db.wordRecords.count() }
    })
    expect(state.registry.active).toEqual(OWNER)
    expect(state.rows).toBe(1)
  } finally { await a.close() }
})
