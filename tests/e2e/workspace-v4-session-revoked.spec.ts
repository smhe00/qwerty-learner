import { expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page, Route } from '@playwright/test'

const OWNER = { kind: 'account' as const, accountId: 's1-revoked-immutable-user' }
const TOKEN_A = 's1-device-A-token'
const TOKEN_B = 's1-device-B-token'

class SessionServer {
  current = TOKEN_A
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
    await pageA.bringToFront()
    const alert = pageA.getByRole('alertdialog')
    await expect(alert).toBeVisible({ timeout: 25_000 })
    await expect(alert).toContainText('账号已在其他设备登录')
    // Do not interpret server-side revocation as local data deletion.
    await alert.getByRole('button',
      { name: '确认退出并切换到本机匿名工作区' }).click()
    await expect.poll(async () => pageA.evaluate(() =>
      window.location.pathname === '/' &&
      !window.location.search.includes('s1-session-revoked'))).toBe(true)

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
    await a.unroute(/\/api\/auth\/(?:me|login)(?:\?|$)/)
    let error = 'temporary_unavailable'
    let status = 503
    await a.route('**/api/auth/me', async route => route.fulfill({
      status, json: { ok: false, error, message: 'not a takeover' },
    }))
    await page.goto('/')
    await page.bringToFront()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    status = 401
    error = 'session_expired'
    await page.reload()
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
