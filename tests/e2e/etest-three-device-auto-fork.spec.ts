import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Hard BLACK-BOX criterion: actual Learn UI; 3 isolated Chromium contexts;
 * B/C offline for independent branch creation, then staggered reconnect.
 * No manual Sync, reload, direct snapshot mutation, or merge API calls.
 * Deliberately FAILS until M2/M4 automatically adopt all immutable attempts.
 */
const base = process.env.QWERTY_SYNC_BASE_URL ?? ''
const origin = 'https://etest.edgeone.dev'
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type RecordRow = { id: number; attemptId: string; dict: string; word: string; timeStamp: number }

async function records(page: Page): Promise<RecordRow[]> {
  return page.evaluate(async () => {
    const request = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      request.onsuccess = () => ok(request.result)
      request.onerror = () => fail(request.error)
    })
    try {
      const req = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').getAll()
      return await new Promise<RecordRow[]>((ok, fail) => {
        req.onsuccess = () => ok(req.result as RecordRow[])
        req.onerror = () => fail(req.error)
      })
    } finally { db.close() }
  })
}
async function jsonApi(path: string, method: string, body: object, token?: string) {
  const response = await fetch(new URL(path, base), {
    method, redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(40_000),
  })
  const result = await response.json()
  return { status: response.status, body: result }
}
async function loginUi(page: Page, username: string, password: string) {
  await page.goto(new URL('/?s1-account=manage', base).href,
    { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: '安全账户管理（S1）' })
  await expect(dialog).toBeVisible({ timeout: 45_000 })
  await page.getByPlaceholder('用户名').fill(username)
  await page.getByPlaceholder('账户密码').fill(password)
  page.on('dialog', async confirm => {
    await confirm.accept()
  })
  await page.getByRole('button', { name: '登录已有账户' }).click()
  await expect.poll(() => page.evaluate(() => {
    const auth = localStorage.getItem('qwerty.cloudAuth.v1')
    return auth ? JSON.parse(auth)?.user?.username : null
  }).catch(() => null), { timeout: 60_000 }).toBe(username)
  await expect(page.getByText('学习数据安全检查未通过')).toHaveCount(0)
}
async function launchLearn(page: Page) {
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
async function studyOne(page: Page, spelling: string) {
  const oldIds = new Set((await records(page)).map(r => r.attemptId))
  if (await page.getByText('按任意键开始').isVisible().catch(() => false)) {
    await page.keyboard.press('a')
  }
  await page.keyboard.type(spelling)
  let created: RecordRow | undefined
  await expect.poll(async () => {
    created = (await records(page)).find(r => r.attemptId && !oldIds.has(r.attemptId))
    return created?.attemptId ?? null
  }, { timeout: 45_000 }).not.toBeNull()
  expect(created?.attemptId).toMatch(uuidV4)
  return created!
}

test('three-device offline B/C forks automatically converge through true UI', async ({ browser }) => {
  test.setTimeout(390_000)
  expect(process.env.GITHUB_REF_NAME).toBe('edgeone-test')
  expect(new URL(base).origin).toBe(origin)
  expect(process.env.GITHUB_RUN_ID).toMatch(/^[0-9]+$/)
  const username = 'e2e_fork_' + process.env.GITHUB_RUN_ID + '_' +
    (process.env.GITHUB_RUN_ATTEMPT || '1')
  const password = 'E2E-' + crypto.randomUUID() + '-test'
  const contexts: BrowserContext[] = []
  let accountId: string | undefined
  try {
    const registration = await jsonApi('/api/auth/register', 'POST', {
      username, password, deviceId: 'qwerty-web-' + crypto.randomUUID(),
    })
    expect(registration.status).toBe(201)
    accountId = registration.body.user?.userId
    expect(accountId).toBeTruthy()
    const pages: Page[] = []
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ serviceWorkers: 'block' })
      contexts.push(context)
      const page = await context.newPage()
      pages.push(page)
      await loginUi(page, username, password)
    }
    const authMode = await pages[0].evaluate(async () =>
      (await (await fetch('/api/health', { cache: 'no-store' })).json()).authMode)
    expect(authMode).toBe('independent-device-sessions-pilot')
    const words = []
    for (const page of pages) words.push(await launchLearn(page))
    expect((await Promise.all(pages.map(records))).map(r => r.length))
      .toEqual([0, 0, 0])
    // REAL browser network isolation, not synthetic skip of fetch calls.
    await contexts[1].setOffline(true)
    await contexts[2].setOffline(true)
    const branchA = await studyOne(pages[0], words[0])
    const branchB = await studyOne(pages[1], words[1])
    const branchC = await studyOne(pages[2], words[2])
    const oracle = new Map([branchA, branchB, branchC].map(x => [x.attemptId, x]))
    expect(oracle.size).toBe(3)
    const finalIds = [...oracle.keys()].sort()
    for (let i = 0; i < 3; i++) {
      const local = await records(pages[i])
      expect(local.some(r => r.attemptId === [branchA, branchB, branchC][i].attemptId))
        .toBe(true)
    }
    // No manual sync, reload, login or test code calling application internals.
    await contexts[1].setOffline(false)
    await expect.poll(async () =>
      (await records(pages[1])).some(r => r.attemptId === branchA.attemptId),
      { timeout: 150_000 }).toBe(true)
    await contexts[2].setOffline(false)
    await Promise.all(pages.map(async (page, i) => {
      await expect.poll(async () =>
        (await records(page)).filter(r => oracle.has(r.attemptId))
          .map(r => r.attemptId).sort(),
        { timeout: 180_000, message: 'device ' + i + ' no automatic convergence' })
        .toEqual(finalIds)
    }))
    for (const page of pages) {
      const final = await records(page)
      for (const [id, original] of oracle) {
        const one = final.filter(row => row.attemptId === id)
        expect(one).toHaveLength(1)
        expect(one[0].dict).toBe(original.dict)
        expect(one[0].word).toBe(original.word)
        expect(one[0].timeStamp).toBe(original.timeStamp)
      }
    }
    console.log('PASS black-box: 3 real Learn devices, offline forks and zero-click convergence')
  } finally {
    await Promise.allSettled(contexts.map(ctx => ctx.close()))
    if (accountId) {
      // Cleanup requires fresh credentials and exact disposable account owner.
      expect(username).toMatch(/^e2e_fork_[0-9]+_[0-9]+$/)
      const login = await jsonApi('/api/auth/login', 'POST',
        { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
      expect(login.status).toBe(200)
      expect(login.body.user?.userId).toBe(accountId)
      const deleted = await jsonApi('/api/auth/account', 'DELETE',
        { currentPassword: password }, login.body.token)
      expect(deleted.status).toBe(200)
      expect(deleted.body.deleted?.accountDeleted).toBe(true)
    }
  }
})
