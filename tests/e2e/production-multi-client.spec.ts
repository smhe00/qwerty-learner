import { expect, test, type Page } from '@playwright/test'

/**
 * Real production, UI-driven, deliberately isolated.
 * All identities are disposable; all browser contexts are separate.
 * Do not use against a personal account or an unpublished S1 build.
 *
 * Single-active-session is intentional: a second login to the same username
 * revokes the first browser's cloud session, but must preserve its local DB.
 */
const baseUrl = process.env.QWERTY_SYNC_BASE_URL
const usernameA = process.env.QWERTY_E2E_USERNAME
const usernameB = process.env.QWERTY_E2E_USERNAME_B
const password = process.env.QWERTY_E2E_PASSWORD

test('three real clients: two identities, revoked sessions, conflict, restore and isolation', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  if (!baseUrl || !usernameA || !usernameB || !password) {
    throw new Error('Production URL and disposable E2E identities must be configured')
  }
  if (usernameA === usernameB || !/^e2e_mc_[a-zA-Z0-9_]+$/.test(usernameA) ||
      !/^e2e_mc_[a-zA-Z0-9_]+$/.test(usernameB)) {
    throw new Error('Refusing live execution without distinct disposable account names')
  }

  // Require the expected live backend. This test never deploys to EdgeOne.
  const healthContext = await browser.newContext()
  try {
    const response = await healthContext.request.get(new URL('/api/health', baseUrl).toString())
    expect(response.ok(), 'Live EdgeOne health endpoint').toBe(true)
    const health = await response.json()
    expect(health.service).toBe('qwerty-sync-gateway')
    expect(health.capabilities).toContain('learning-state-backup-v3')
  } finally {
    await healthContext.close()
  }

  const contextA1 = await browser.newContext()
  const contextA2 = await browser.newContext()
  const contextB1 = await browser.newContext()
  const a1 = await contextA1.newPage()
  const a2 = await contextA2.newPage()
  const b1 = await contextB1.newPage()

  async function settings(page: Page) {
    await page.goto(baseUrl!, { waitUntil: 'domcontentloaded' })
    const dismiss = page.getByRole('button', { name: '关闭提示' })
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click()
    await page.getByRole('button', { name: '打开设置对话框' }).click()
    await page.getByRole('tab', { name: '数据设置' }).click()
    await expect(page.getByText('云端同步', { exact: true })).toBeVisible()
  }

  async function register(page: Page, username: string) {
    await page.getByPlaceholder('用户名').fill(username)
    await page.getByPlaceholder('密码（4-128字符）').fill(password!)
    await page.getByPlaceholder('再次输入密码（仅注册）').fill(password!)
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await expect(page.getByText(`账号：${username}`)).toBeVisible()
  }

  async function login(page: Page, username: string) {
    await page.getByPlaceholder('用户名').fill(username)
    await page.getByPlaceholder('密码（4-128字符）').fill(password!)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByText(`账号：${username}`)).toBeVisible()
  }

  async function logout(page: Page) {
    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  }

  async function addWord(page: Page, word: string) {
    await page.evaluate(async (marker) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('RecordDB')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('wordRecords', 'readwrite')
          tx.objectStore('wordRecords').add({
            word: marker,
            dict: 'cet4',
            chapter: 0,
            timeStamp: Math.floor(Date.now() / 1000),
            timing: [71, 91, 111],
            wrongCount: 0,
            mistakes: {},
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    }, word)
  }

  async function words(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('RecordDB')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        return await new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction('wordRecords', 'readonly')
          const req = tx.objectStore('wordRecords').getAll()
          req.onsuccess = () => resolve(req.result.map((item) => item.word as string))
          req.onerror = () => reject(req.error)
        })
      } finally {
        db.close()
      }
    })
  }

  async function refresh(page: Page) {
    await page.getByRole('button', { name: '刷新状态' }).click()
    await expect(page.getByText('同步状态已刷新。')).toBeVisible()
  }

  async function upload(page: Page, revision: number) {
    await page.getByRole('button', { name: '上传本地数据' }).click()
    await expect(page.getByText(`已上传到云端 revision ${revision}。`)).toBeVisible()
    await expect(page.getByText('本地与云端一致')).toBeVisible()
  }

  // Keep the production replay trace strictly redacted: no credentials,
  // usernames, localStorage values or actual cloud payloads.
  const trace: Array<{ event: string; client: string; revision?: number }> = []
  const mark = (event: string, client: string, revision?: number) =>
    trace.push({ event, client, ...(revision === undefined ? {} : { revision }) })

  const wordA1 = `e2e-${usernameA}-first`
  const wordA2 = `e2e-${usernameA}-remote`
  const wordStale = `e2e-${usernameA}-stale-local`
  const wordB = `e2e-${usernameB}-only`

  try {
    // A1 creates the cloud baseline and uploads a real IndexedDB snapshot.
    await settings(a1)
    await register(a1, usernameA)
    await addWord(a1, wordA1)
    await refresh(a1)
    await expect(a1.getByText('本地有未上传修改')).toBeVisible()
    await upload(a1, 1)
    mark('first-upload-asserted', 'A1', 1)

    // Separate identity B must start with no A data (locally or remotely).
    await settings(b1)
    await register(b1, usernameB)
    expect(await words(b1)).not.toContain(wordA1)
    await expect(b1.getByText('云端 revision：')).toContainText('0')
    await addWord(b1, wordB)
    await refresh(b1)
    await upload(b1, 1)
    mark('isolated-identity-upload-asserted', 'B1', 1)

    // Same account, different browser: A2 login revokes A1's cloud session.
    await settings(a2)
    await login(a2, usernameA)
    const a1Revoked = await a1.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('qwerty.cloudAuth.v1') || 'null')
      return (await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${auth?.token || ''}` },
      })).status
    })
    expect(a1Revoked).toBe(401)
    expect(await words(a1)).toContain(wordA1)
    mark('revoked-session-kept-local-data', 'A1') // revoked is NOT local deletion

    // A2 explicitly downloads; without any subsequent learning its state
    // must be CLEAN even after navigation/reload (import false-dirty regression).
    pageDialogAutoAccept(a2)
    await a2.getByRole('button', { name: '使用云端数据' }).click()
    await expect.poll(() => words(a2)).toContain(wordA1)
    await settings(a2)
    await refresh(a2)
    await expect(a2.getByText('本地与云端一致')).toBeVisible()
    await a2.reload()
    await settings(a2)
    await refresh(a2)
    await expect(a2.getByText('本地与云端一致')).toBeVisible()
    expect(await words(a2)).not.toContain(wordB)
    mark('remote-restore-remains-clean-after-reload', 'A2', 1)

    // Create local unuploaded A2 edits; A1 logs back in and moves the cloud
    // forward. Explicit reauth must detect both-sided divergence, never overwrite.
    await addWord(a2, wordStale)
    await refresh(a2)
    await expect(a2.getByText('本地有未上传修改')).toBeVisible()
    await logout(a1)
    await login(a1, usernameA)
    await addWord(a1, wordA2)
    await refresh(a1)
    await upload(a1, 2)
    mark('remote-revision-increment', 'A1', 2)

    await logout(a2)
    await login(a2, usernameA)
    await refresh(a2)
    await expect(a2.getByText('本地与云端均有变化，需要手动选择')).toBeVisible()
    expect(await words(a2)).toContain(wordStale)
    expect(await words(a2)).not.toContain(wordA2)
    mark('divergence-without-silent-overwrite', 'A2', 2)

    // The first dialog handler stays active for this page. Do not attach it
    // again, otherwise both handlers try to accept the same browser dialog.
    await a2.getByRole('button', { name: '使用云端数据' }).click()
    await expect.poll(() => words(a2)).toContain(wordA2)
    await settings(a2)
    await refresh(a2)
    await expect(a2.getByText('本地与云端一致')).toBeVisible()
    expect(await words(a2)).toContain(wordA1)
    expect(await words(a2)).not.toContain(wordStale)
    expect(await words(a2)).not.toContain(wordB)
    await refresh(b1)
    await expect(b1.getByText('云端 revision：')).toContainText('1')
    expect(await words(b1)).toContain(wordB)
    expect(await words(b1)).not.toContain(wordA1)
    mark('explicit-restore-and-account-isolation', 'A2', 2)
    mark('independent-identity-unaffected', 'B1', 1)
  } finally {
    await test.info().attach('production-multi-client-redacted-trace.json', {
      body: Buffer.from(JSON.stringify({ schema: 'cloud-ui-trace-v1', trace }, null, 2)),
      contentType: 'application/json',
    })
    await Promise.allSettled([contextA1.close(), contextA2.close(), contextB1.close()])
  }
})

function pageDialogAutoAccept(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
}
