import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/** True browser/S1/EdgeOne path; no Pages, mock cloud, or personal accounts. */
const base = process.env.QWERTY_SYNC_BASE_URL
const userA = process.env.QWERTY_E2E_USERNAME
const userB = process.env.QWERTY_E2E_USERNAME_B
const password = process.env.QWERTY_E2E_PASSWORD

test('two cloud identities in three isolated Chromium S1 profiles', async ({ browser }) => {
  test.setTimeout(180_000)
  if (!base || !userA || !userB || !password ||
      !/^e2e_mc_[0-9]+_[0-9]+_a$/.test(userA) ||
      !/^e2e_mc_[0-9]+_[0-9]+_b$/.test(userB)) {
    throw new Error('Only uniquely named disposable EdgeOne E2E accounts are allowed')
  }
  if (process.env.GITHUB_REF_NAME !== 'edgeone-test') {
    throw new Error('Staging cloud E2E only runs on edgeone-test')
  }
  const expected = 'https://etest.edgeone.dev'
  expect(new URL(base).origin).toBe(expected)
  const contexts: BrowserContext[] = []
  const open = async (): Promise<Page> => {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    contexts.push(context)
    const page = await context.newPage()
    const forbidden: string[] = []
    page.on('request', request => {
      const parsed = new URL(request.url())
      if (parsed.pathname.startsWith('/api/') && parsed.origin !== expected) {
        forbidden.push(parsed.origin)
      }
    })
    const entry = base + '?s1-account=manage'
    await page.goto(entry, { waitUntil: 'domcontentloaded' })
    const accountDialog = page.getByRole('dialog', { name: '安全账户管理（S1）' })
    try {
      await expect(accountDialog).toBeVisible({ timeout: 12000 })
    } catch {
      // S1 first-boot deliberately commits a workspace and reloads into a
      // fresh JavaScript realm; EdgeOne may also be publishing a new build.
      // Retry only the pre-login entry. Never retry auth or write operations.
      const headings = await page.locator('h1,h2,[role="status"]')
        .allTextContents().catch(() => [])
      console.log('S1 entry diagnostic', {
        pathname: new URL(page.url()).pathname,
        hasAccountDialog: await accountDialog.count().catch(() => 0),
        headingCount: headings.length,
        headingSamples: headings.slice(0, 3).map(s => s.slice(0, 60)),
      })
      await page.goto(entry, { waitUntil: 'domcontentloaded' })
      await expect(accountDialog).toBeVisible({ timeout: 35000 })
    }
    expect(forbidden, 'API calls must stay on the branch-matched EdgeOne origin').toEqual([])
    return page
  }
  const signIn = async (page: Page, username: string, register: boolean) => {
    await page.getByPlaceholder('用户名').fill(username)
    await page.getByPlaceholder('账户密码').fill(password)
    if (register) {
      await page.getByPlaceholder('注册密码确认').fill(password)
    }
    const currentUrl = page.url()
    const dialogs: string[] = []
    page.on('dialog', async dialog => {
      dialogs.push(dialog.message())
      if (dialog.message().includes('复制到新账户')) await dialog.dismiss()
      else await dialog.accept()
    })
    await page.getByRole('button', {
      name: register ? '注册新账户' : '登录已有账户',
    }).click()
    // Registration and S1 Vault switching deliberately replace the document.
    // Wait for the navigation before evaluating; transient realm destruction
    // is not a failed login or permission to skip the durable auth assertion.
    await expect(page).not.toHaveURL(currentUrl, { timeout: 60000 })
    await expect.poll(async () => page.evaluate(() => {
      const json = localStorage.getItem('qwerty.cloudAuth.v1')
      return json ? JSON.parse(json)?.user?.username : null
    }).catch(() => null), { timeout: 60000 }).toBe(username)
    expect(dialogs.length).toBeGreaterThanOrEqual(register ? 2 : 1)
  }
  try {
    const a1 = await open()
    await signIn(a1, userA, true)
    const aId = await a1.evaluate(() =>
      JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').user?.userId)
    expect(aId).toBeTruthy()

    const b1 = await open()
    await signIn(b1, userB, true)
    const bId = await b1.evaluate(() =>
      JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').user?.userId)
    expect(bId).toBeTruthy()
    expect(bId).not.toBe(aId)

    const a2 = await open()
    await signIn(a2, userA, false)
    const latest = await a2.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}')
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + auth.token },
      })
      return { status: res.status, userId: (await res.json()).user?.userId }
    })
    expect(latest.status).toBe(200)
    expect(latest.userId).toBe(aId)
    const previous = await a1.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}')
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + auth.token },
      })
      return res.status
    })
    const health = await a2.evaluate(async () =>
      (await (await fetch('/api/health')).json()).authMode)
    expect(previous).toBe(health === 'single-active-session' ? 401 : 200)
    const other = await b1.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}')
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + auth.token },
      })
      return res.status
    })
    expect(other).toBe(200)
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()))
  }
})
