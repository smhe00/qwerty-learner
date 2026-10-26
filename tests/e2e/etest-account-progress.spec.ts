import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const base = 'https://t.smhe.cn'
async function request(path: string, method = 'GET', body?: object, token?: string) {
  const response = await fetch(base + path, { method, redirect: 'error', signal: AbortSignal.timeout(40_000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, body: await response.json() }
}
async function dismissNotice(page: Page) {
  const close = page.getByRole('button', { name: '知道了', exact: true })
  if (await close.isVisible()) await close.click()
}
async function login(page: Page, username: string, password: string) {
  await page.goto(base + '/?s1-account=manage&s1-reauth=1')
  await expect(page.getByLabel('账户密码', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('账户密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: /^(登录|确认重新登录)$/ }).click()
  await expect(page).toHaveURL(/^https:\/\/t\.smhe\.cn\/(?:learn)?$/, { timeout: 120_000 })
  await expect(page.locator('[data-account-entry]')).toBeVisible({ timeout: 60_000 })
  await dismissNotice(page)
}
async function readRows(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((ok, fail) => { open.onsuccess = () => ok(open.result); open.onerror = () => fail(open.error) })
    try { return await new Promise<unknown[]>((ok, fail) => {
      const get = db.transaction('wordRecords').objectStore('wordRecords').getAll()
      get.onsuccess = () => ok(get.result); get.onerror = () => fail(get.error)
    }) } finally { db.close() }
  })
}

test('etest revoked reauth, review completion, themed dialog and no-op document continuity', async ({ browser }, info) => {
  expect(process.env.GITHUB_REF_NAME).toBe('edgeone-test')
  expect(process.env.QWERTY_SYNC_BASE_URL).toBe(base + '/')
  const sha = process.env.GITHUB_SHA || ''
  expect(sha).toMatch(/^[a-f0-9]{40}$/)
  const source = (await (await fetch(base + '/source-commit.txt?ui=' + Date.now())).text()).trim()
  expect(source).toMatch(/^[a-f0-9]{7,40}$/)
  expect(sha.startsWith(source)).toBe(true)
  const username = 'e2e_ui_' + Date.now()
  const password = 'Ui-' + crypto.randomUUID()
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })])
  const pages = await Promise.all(contexts.map(c => c.newPage()))
  pages.forEach(p => p.on('dialog', d => d.accept()))
  const proof: Record<string, unknown> = { source, syntheticAccount: true }
  let owner: string | undefined
  const errors: unknown[] = []
  try {
    const created = await request('/api/auth/register', 'POST', { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
    expect(created.status).toBe(201)
    owner = created.body.user.userId
    await login(pages[0], username, password)
    // Only this freshly created account is seeded, while the domain app is unmounted.
    await pages[0].goto(base + '/?s1-account=manage')
    await expect(pages[0].locator('[data-account]')).toBeVisible()
    await pages[0].evaluate(async () => {
      const now = Math.floor(Date.now() / 1000)
      const dict = 'cet4'
      const words = ['cancel', 'abandon']
      const open = indexedDB.open('RecordDB')
      const db = await new Promise<IDBDatabase>((ok, fail) => { open.onsuccess = () => ok(open.result); open.onerror = () => fail(open.error) })
      try { await new Promise<void>((ok, fail) => {
        const tx = db.transaction(['wordRecords', 'reviewWordStates'], 'readwrite')
        words.forEach((word, index) => {
          const rating = index === 0 ? 'again' : 'good'
          tx.objectStore('wordRecords').add({ word, dict, chapter: -1, timeStamp: now - 10, timing: [100], wrongCount: index === 0 ? 1 : 0,
            mistakes: {}, sourceMode: 'learn', learnItemKind: 'review',
            reviewEvidence: { version: 1, memoryGrade: rating, errorCause: index === 0 ? 'recall' : 'clean', confidence: 1,
              evidenceStrength: 1, retrievalValidity: 'independent', reasonCodes: ['synthetic-cold-review'] },
            reviewRatingDecision: { eligible: true, rating, confidence: 1, reasonCodes: ['synthetic-cold-review'] } })
          tx.objectStore('reviewWordStates').add({ dict, word, createdAt: now - 1000, updatedAt: now - 10, lastReviewedAt: now - 10,
            nextReviewAt: now + 86400, reviewCount: 1, lapseCount: index === 0 ? 1 : 0, cleanStreak: index, lastOutcome: rating,
            lifecycle: 'active', stateVersion: 5, schedulerState: { kind: 'basic-v2', stage: 0, intervalDays: 1 } })
        })
        tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error)
      }) } finally { db.close() }
      const date = new Date(now * 1000)
      const dateKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
      localStorage.setItem('currentDict', JSON.stringify(dict))
      localStorage.setItem('isOpenDarkModeAtom', 'true')
      localStorage.setItem('qwerty.learn.dailySession.v1.' + dict, JSON.stringify({ version: 1, sessionId: 'synthetic-ui-plan', dict,
        dateKey, startedAt: now - 100, status: 'active', executionExhausted: true, dailyNewTarget: 0, plannedNewWords: 0,
        plannedNewWordNames: [], plannedReviewWords: words, carryOverAcquisitionWords: [], completedBlockIds: [], blockCount: 0, accumulatedActiveSeconds: 0 }))
    })
    const originalRows = await readRows(pages[0])
    expect(originalRows).toHaveLength(2)
    await pages[0].setViewportSize({ width: 500, height: 800 })
    await pages[0].goto(base + '/mobile')
    const progress = pages[0].locator('[data-mobile-daily-progress]')
    await expect(progress).toContainText('复习已完成')
    await expect(progress).toContainText('2 / 2')
    await expect(progress).toContainText('独立答对 1 词，需巩固 1 词')
    await expect(progress).toContainText('今日练习已完成')
    const timeOrigin = await pages[0].evaluate(() => performance.timeOrigin)
    await pages[0].getByRole('link', { name: /账号与云同步/ }).click()
    await expect(pages[0].locator('[data-account-overview]')).toBeVisible()
    await pages[0].getByRole('button', { name: '关闭账号窗口' }).click()
    await pages[0].setViewportSize({ width: 1280, height: 800 })
    await expect(pages[0]).toHaveURL(base + '/learn')
    expect(await pages[0].evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
    expect(await readRows(pages[0])).toEqual(originalRows)
    proof.progress = { reviewCompleted: 2, independentPassed: 1, consolidation: 1 }
    proof.noOpAccountAndResizeSameDocument = true
    // A second actual browser login revokes A. Reclaim only through the visible alert.
    await login(pages[1], username, password)
    await pages[0].waitForTimeout(5500)
    await pages[0].bringToFront()
    const revoked = pages[0].getByRole('alertdialog')
    await expect(revoked).toBeVisible({ timeout: 45_000 })
    await revoked.getByRole('button', { name: '重新登录当前账号并继续' }).click()
    await expect(pages[0].getByLabel('账户密码', { exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(pages[0].locator('[data-account]')).toHaveAttribute('data-theme', 'dark')
    await pages[0].getByLabel('账户密码', { exact: true }).fill(password)
    const signed = pages[0].waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login')
    await pages[0].getByRole('button', { name: '确认重新登录', exact: true }).click()
    expect((await signed).status()).toBe(200)
    await expect(pages[0]).toHaveURL(base + '/learn', { timeout: 120_000 })
    await expect(pages[0].locator('[data-account-entry]')).toBeVisible({ timeout: 30_000 })
    expect(await readRows(pages[0])).toEqual(originalRows)
    proof.revokedReauthWithoutLogout = true
    proof.originalRowsUnchanged = true
    proof.darkAccountDialog = true
  } catch (error) { errors.push(error); proof.applicationFailed = true }
  finally {
    await Promise.allSettled(contexts.map(c => c.close()))
    if (owner) {
      try {
        const fresh = await request('/api/auth/login', 'POST', { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() })
        expect(fresh.status).toBe(200)
        expect(fresh.body.user.userId).toBe(owner)
        const removed = await request('/api/auth/account', 'DELETE', { currentPassword: password }, fresh.body.token)
        expect(removed.status).toBe(200)
        expect(removed.body.deleted?.accountDeleted).toBe(true)
        proof.cleanupVerified = true
      } catch(error) { errors.push(error); proof.cleanupFailed = true }
    }
    await writeFile(info.outputPath('account-progress-redacted.json'), JSON.stringify(proof, null, 2))
    console.log('ACCOUNT_PROGRESS_PROOF', JSON.stringify(proof))
  }
  if(errors.length) throw new AggregateError(errors)
})
