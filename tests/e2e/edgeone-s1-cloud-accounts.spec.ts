import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/** True browser/S1/EdgeOne path; no Pages, mock cloud, or personal accounts. */
const base = process.env.QWERTY_SYNC_BASE_URL
const userA = process.env.QWERTY_E2E_USERNAME
const userB = process.env.QWERTY_E2E_USERNAME_B
const password = process.env.QWERTY_E2E_PASSWORD

for (const missingWebLocks of [false, true]) {
test(`P0: fresh etest anonymous Learn, account and clear (${missingWebLocks ? 'fallback' : 'native'} locks)`, async ({ browser }) => {
  test.setTimeout(180_000)
  if (process.env.GITHUB_REF_NAME !== 'edgeone-test' ||
    new URL(base || '').origin !== 'https://t.smhe.cn') {
    throw Error('Only branch-matched etest may exercise the real first-visit path')
  }
    const context = await browser.newContext({ serviceWorkers: 'block' })
    console.log('P0 staging browser startup', { missingWebLocks })
    try {
      if (missingWebLocks) {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
          Object.defineProperty(crypto, 'subtle', { configurable: true, value: undefined })
          Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
        })
      }
      const page = await context.newPage()
      // The previous E2E went directly to ?s1-account=manage and never
      // exercised an anonymous learner who decides to log in later.
      console.log('P0 staging checkpoint: loading anonymous entry')
      await page.goto(base!, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: '打开设置对话框' }))
        .toBeVisible({ timeout: 40_000 })
      console.log('P0 staging checkpoint: entering Learn')
      await page.goto(new URL('/learn', base).toString())
      const start = page.getByRole('button', { name: '开始 Learn', exact: true })
      await expect(start).toBeVisible({ timeout: 30_000 })
      await start.click()
      const word = page.locator('[data-typing-word]').first()
      await expect(word).toBeVisible({ timeout: 30_000 })
      const spelling = await word.getAttribute('data-typing-word')
      expect(spelling).toBeTruthy()
      if (await page.getByText('按任意键开始').isVisible().catch(() => false)) {
        await page.keyboard.press('a')
      }
      await page.keyboard.type(spelling!)
      const recordCount = async () => page.evaluate(async () => {
        const request = indexedDB.open('RecordDB')
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          const record = db.transaction('wordRecords', 'readonly')
            .objectStore('wordRecords').count()
          return await new Promise<number>((resolve, reject) => {
            record.onsuccess = () => resolve(record.result)
            record.onerror = () => reject(record.error)
          })
        } finally { db.close() }
      })
      console.log('P0 staging checkpoint: waiting for persistent learning evidence')
      await expect.poll(recordCount, { timeout: 30_000 }).toBeGreaterThan(0)
      const before = await recordCount()
      console.log('P0 staging checkpoint: opening account entry')
      await page.locator('[data-account-entry]').click()
      await page.getByRole('button', { name: /^(登录或注册|登录与账号管理)$/ }).click()
      await expect(page.locator('[data-account]'))
        .toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('S1 本机学习数据归属确认')).toHaveCount(0)
      await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
      // A login entry must not silently erase the anonymous study record.
      expect(await recordCount()).toBe(before)

      // P0 published-site regression: from real anonymous learning, the
      // Settings action must perform a GUARDED S1 reset, not call the
      // old legacy destructive API which always refuses generation > 0.
      await page.goto(base!, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: '打开设置对话框' }))
        .toBeVisible({ timeout: 30_000 })
      await page.getByRole('button', { name: '打开设置对话框' }).click()
      await page.getByRole('tab', { name: '数据与备份' }).click()
      await page.getByText('高级操作 · 清除本地数据').click()
      await page.getByRole('button', { name: '清除本地数据', exact: true }).click()
      await expect(page.getByRole('heading', { name: '清除当前工作区的本地学习数据' }))
        .toBeVisible({ timeout: 30_000 })
      await page.getByLabel('我确认仅清除当前工作区的本地学习记录').check()
      page.once('dialog', dialog => dialog.accept())
      await page.getByRole('button', { name: '确认清除本地学习数据' }).click()
      await expect(page.getByText(/当前工作区的本地学习记录已清除/))
        .toBeVisible({ timeout: 35_000 })
      await expect.poll(recordCount, { timeout: 20_000 }).toBe(0)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
      await page.goto(new URL('/?s1-account=manage', base).toString())
      await expect(page.locator('[data-account]'))
        .toBeVisible({ timeout: 30_000 })
      expect(await recordCount()).toBe(0)
    } finally {
      // On Playwright's timeout the test is already terminated; do not let a
      // context.close() rejection obscure the actual failed locator/step.
      await context.close().catch(() => {})
    }
})
}

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
  const expected = 'https://t.smhe.cn'
  expect(new URL(base).origin).toBe(expected)
  const contexts: BrowserContext[] = []
  const open = async (noWebLocks = false): Promise<Page> => {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    contexts.push(context)
    if (noWebLocks) {
      // Execute in every document BEFORE S1 pre-mount boot. This tests the
      // production EdgeOne code path, not a mocked workspace controller.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'locks', {
          configurable: true, value: undefined,
        })
        Object.defineProperty(crypto, 'subtle', {
          configurable: true, value: undefined,
        })
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true, value: undefined,
        })
      })
    }
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
    const accountDialog = page.locator('[data-account]')
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
    await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
    return page
  }
  const signIn = async (page: Page, username: string, register: boolean) => {
    if (register) await page.getByRole('tab', { name: '注册', exact: true }).click()
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('账户密码', { exact: true }).fill(password)
    if (register) {
      await page.getByLabel('注册密码确认', { exact: true }).fill(password)
    }
    const currentUrl = page.url()
    const dialogs: string[] = []
    const authStatuses: string[] = []
    // Strictly redacted metadata: no URL query string, usernames, tokens,
    // request/response body or password may enter uploaded CI logs.
    const onAuthResponse = (response: import('@playwright/test').Response) => {
      try {
        const path = new URL(response.url()).pathname
        if (path === '/api/auth/register' || path === '/api/auth/login') {
          authStatuses.push(path + ':HTTP-' + response.status())
        }
      } catch { /* Ignore navigation noise */ }
    }
    page.on('response', onAuthResponse)
    page.on('dialog', async dialog => {
      dialogs.push(dialog.message())
      if (dialog.message().includes('是否把本机匿名学习记录')) await dialog.dismiss()
      else await dialog.accept()
    })
    try {
      await page.getByRole('button', {
        name: register ? '注册并登录' : '登录', exact: true,
      }).click()
      // Registration and S1 Vault switching deliberately replace the
      // document. Never repeat a possibly successful registration.
      await expect(page).not.toHaveURL(currentUrl, { timeout: 60000 })
      await expect.poll(async () => page.evaluate(() => {
        const json = localStorage.getItem('qwerty.cloudAuth.v1')
        return json ? JSON.parse(json)?.user?.username : null
      }).catch(() => null), { timeout: 60000 }).toBe(username)
      expect(dialogs.length).toBeGreaterThanOrEqual(register ? 2 : 1)
    } catch (error) {
      console.error('S1 etest auth checkpoint', {
        kind: register ? 'registration' : 'login',
        api: authStatuses,
        dialogCount: dialogs.length,
        pagePath: new URL(page.url()).pathname,
        status: (await page.locator('[role="status"]').allTextContents()
          .catch(() => [])).slice(0, 3).map(s => s.slice(0, 180)),
        hasSafetyBlock: await page.getByText('学习数据安全检查未通过')
          .isVisible().catch(() => false),
      })
      throw error
    } finally {
      page.off('response', onAuthResponse)
    }
  }
  try {
    // Critical first-visit regression: a completely fresh HTTPS profile
    // with neither Web Locks nor crypto.randomUUID must still initialize S1.
    const a1 = await open(true)
    const duplicate = await a1.context().newPage()
    await duplicate.goto(base + '?s1-account=manage', { waitUntil: 'domcontentloaded' })
    await expect(duplicate.getByText('另一个标签页正在使用学习数据'))
      .toBeVisible({ timeout: 30_000 })
    await duplicate.close()
    await signIn(a1, userA, true)
    await a1.reload({ waitUntil: 'domcontentloaded' })
    await expect(a1.getByText('学习数据安全检查未通过')).toHaveCount(0)
    // Account A has no prior dictionary selection. A new S1 account must
    // not inherit the obsolete zhongkaohexin default from the empty reset.
    expect(await a1.evaluate(() =>
      JSON.parse(localStorage.getItem('currentDict') || 'null')))
      .toBe('shanghai-zhongkao-2027')
    const aId = await a1.evaluate(() =>
      JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').user?.userId)
    expect(aId).toBeTruthy()

    const b1 = await open()
    await signIn(b1, userB, true)
    expect(await b1.evaluate(() =>
      JSON.parse(localStorage.getItem('currentDict') || 'null')))
      .toBe('shanghai-zhongkao-2027')
    const bId = await b1.evaluate(() =>
      JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || '{}').user?.userId)
    expect(bId).toBeTruthy()
    expect(bId).not.toBe(aId)

    const a2 = await open(true)
    await signIn(a2, userA, false)
    await a2.reload({ waitUntil: 'domcontentloaded' })
    await expect(a2.getByText('学习数据安全检查未通过')).toHaveCount(0)
    expect(await a2.evaluate(() =>
      JSON.parse(localStorage.getItem('currentDict') || 'null')))
      .toBe('shanghai-zhongkao-2027')
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


test('etest phone account entry and refresh keep the real login route instead of falling back to home', async ({ browser }) => {
  if (process.env.GITHUB_REF_NAME !== 'edgeone-test' || new URL(base || '').origin !== 'https://t.smhe.cn') {
    throw Error('Mobile account entry may only probe etest')
  }
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'})
  try {
    const page = await context.newPage()
    await page.goto(new URL('/mobile', base).href, {waitUntil:'domcontentloaded'})
    await expect(page.locator('[data-mobile-account-entry]')).toBeVisible({timeout:30000})
    const origin = await page.evaluate(() => performance.timeOrigin)
    await page.locator('[data-mobile-account-entry]').click()
    await expect(page.locator('[data-account-overview]')).toBeVisible()
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
    await page.getByRole('button', { name: '登录或注册', exact: true }).click()
    await expect(page).toHaveURL(/\/mobile\/account\?s1-reauth=1$/)
    await expect(page.getByRole('heading',{name:'登录 QWERTY Plus'})).toBeVisible({timeout:30000})
    await expect(page.getByRole('button',{name:'登录',exact:true})).toBeEnabled()
    await page.reload({waitUntil:'domcontentloaded'})
    await expect(page.getByRole('heading',{name:'登录 QWERTY Plus'})).toBeVisible({timeout:30000})
    await expect(page.locator('[data-mobile-menu]')).toHaveCount(0)
  } finally { await context.close().catch(()=>{}) }
})
