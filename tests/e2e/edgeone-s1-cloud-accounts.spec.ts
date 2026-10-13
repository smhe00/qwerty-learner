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
  const expected = process.env.GITHUB_REF_NAME === 'master'
    ? 'https://qwerty-plus.edgeone.dev' : 'https://q-test.edgeone.cool'
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
    await page.goto(base + '?s1-account=manage', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('dialog', { name: '安全账户管理（S1）' }))
      .toBeVisible({ timeout: 35000 })
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
