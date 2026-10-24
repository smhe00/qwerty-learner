import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// Manual, disposable etest acceptance. No customer profile, credentials or production API.
const base = 'https://t.smhe.cn'
async function ready(page: Page, mobile = false) {
  await expect(page.locator(mobile ? '[data-mobile-menu]' : '[data-account-entry]')).toBeVisible({ timeout: 90_000 })
  const notice = page.locator('dialog.safety-information-dialog[open]')
  if (await notice.isVisible()) await notice.getByRole('button', { name: '知道了', exact: true }).click()
}
async function login(page: Page, username: string, password: string, mobile = false) {
  await page.goto(base + (mobile ? '/mobile' : '/?s1-account=manage'), { waitUntil: 'domcontentloaded' })
  if (mobile) {
    await ready(page, true)
    const historyLength = await page.evaluate(() => history.length)
    await page.getByRole('link', { name: '登录或注册', exact: true }).tap()
    await page.getByRole('button', { name: '登录或注册', exact: true }).tap()
    await expect(page.locator('[data-mobile-account]')).toBeVisible({ timeout: 60_000 })
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
  }
  await expect(page.locator('[data-account]')).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('账户密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await ready(page, mobile)
}
async function facts(page: Page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('RecordDB')
    req.onupgradeneeded = () => req.transaction?.abort()
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      req.onsuccess = () => ok(req.result)
      req.onerror = () => fail(req.error)
    })
    try {
      const rows = await new Promise<unknown[]>((ok, fail) => {
        const q = db.transaction('wordRecords').objectStore('wordRecords').getAll()
        q.onsuccess = () => ok(q.result)
        q.onerror = () => fail(q.error)
      })
      return {
        rows,
        dict: JSON.parse(localStorage.getItem('currentDict') || 'null'),
        daily: JSON.parse(localStorage.getItem('qwerty.learn.dailySession.v1.cet4') || 'null'),
      }
    } finally {
      db.close()
    }
  })
}

test('fresh phone downloads full cloud V4 and displays desktop daily progress', async ({ browser, request }, info) => {
  const expected = process.env.QWERTY_MOBILE_ACCEPTANCE_SHA || ''
  expect(expected).toMatch(/^[a-f0-9]{40}$/)
  const marker = await request.get(base + '/source-commit.txt?mobile=' + Date.now())
  expect(marker.status()).toBe(200)
  const deployed = (await marker.text()).trim()
  expect(deployed).toMatch(/^[a-f0-9]{7,40}$/)
  expect(expected.startsWith(deployed)).toBe(true)
  const username = 'e2e_mobile_' + Date.now()
  const password = 'Mobile-' + crypto.randomUUID()
  const desktop = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Shanghai' })
  const phone = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Shanghai',
  })
  const pc = await desktop.newPage(),
    mobile = await phone.newPage()
  const requests: Array<{ method: string; path: string; status: number }> = []
  mobile.on('response', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/sync/')) requests.push({ method: r.request().method(), path: u.pathname, status: r.status() })
  })
  pc.on('dialog', (d) => d.accept())
  mobile.on('dialog', (d) => d.accept())
  let owner: string | undefined
  const proof: Record<string, unknown> = { source: deployed, physicalPhone: false }
  const failures: unknown[] = []
  try {
    const created = await request.post(base + '/api/auth/register', {
      data: { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() },
    })
    expect(created.status()).toBe(201)
    owner = (await created.json()).user.userId
    await login(pc, username, password)
    await pc.goto(base + '/?s1-account=manage')
    await expect(pc.locator('[data-account]')).toBeVisible({ timeout: 60_000 })
    await pc.evaluate(async () => {
      const req = indexedDB.open('RecordDB')
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        req.onsuccess = () => ok(req.result)
        req.onerror = () => fail(req.error)
      })
      const now = Math.floor(Date.now() / 1000)
      const date = new Date(),
        dateKey = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
      try {
        await new Promise<void>((ok, fail) => {
          const tx = db.transaction('wordRecords', 'readwrite')
          tx.objectStore('wordRecords').add({
            word: 'abandon',
            dict: 'cet4',
            chapter: -1,
            timeStamp: now - 30,
            timing: [100],
            wrongCount: 0,
            mistakes: {},
            sourceMode: 'learn',
            learnItemKind: 'review',
            reviewEvidence: {
              version: 1,
              memoryGrade: 'good',
              errorCause: 'clean',
              confidence: 1,
              evidenceStrength: 1,
              retrievalValidity: 'independent',
              reasonCodes: ['independent-clean'],
            },
            reviewRatingDecision: { eligible: true, rating: 'good', confidence: 1, reasonCodes: ['independent-clean'] },
          })
          tx.oncomplete = () => ok()
          tx.onerror = () => fail(tx.error)
          tx.onabort = () => fail(tx.error)
        })
        localStorage.setItem('currentDict', JSON.stringify('cet4'))
        localStorage.setItem(
          'qwerty.learn.dailySession.v1.cet4',
          JSON.stringify({
            version: 1,
            sessionId: 'synthetic-mobile:' + dateKey,
            dict: 'cet4',
            dateKey,
            startedAt: now - 60,
            status: 'active',
            dailyNewTarget: 1,
            plannedNewWords: 0,
            plannedNewWordNames: [],
            plannedReviewWords: ['abandon', 'ability'],
            carryOverAcquisitionWords: [],
            accumulatedActiveSeconds: 5,
            completedBlockIds: [],
            blockCount: 0,
          }),
        )
      } finally {
        db.close()
      }
    })
    const original = await facts(pc)
    expect(original.rows).toHaveLength(1)
    let pushed = false
    pc.on('response', (r) => {
      if (r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/sync/v2/binary/direct' && r.status() === 200) pushed = true
    })
    await pc.goto(base + '/learn', { waitUntil: 'domcontentloaded' })
    await ready(pc)
    expect(pushed).toBe(true)
    // Park the old single-session client before authenticating the empty phone.
    await pc.goto(base + '/?s1-account=manage')
    await expect(pc.locator('[data-account]')).toBeVisible({ timeout: 60_000 })
    await login(mobile, username, password, true)
    const restored = await facts(mobile)
    expect(restored).toEqual(original)
    await expect(mobile.locator('.mobile-today-dictionary')).toContainText('CET-4')
    await expect(mobile.getByRole('progressbar', { name: '今日目标进度' })).toHaveAttribute('aria-valuenow', '1')
    await expect(mobile.getByRole('progressbar', { name: '今日目标进度' })).toHaveAttribute('aria-valuetext', '1 / 2')
    expect(requests.some((r) => r.path === '/api/sync/v2/meta' && r.status === 200)).toBe(true)
    expect(requests.some((r) => r.path === '/api/sync/v2/binary/manifest' && r.status === 200)).toBe(true)
    expect(requests.some((r) => r.path === '/api/sync/v2/binary/part' && r.status === 200)).toBe(true)
    proof.fullV4Exact = true
    proof.mobileDailyProgress = '1 / 2'
    proof.selectedDictionaryRestored = true
  } catch (e) {
    failures.push(e)
    proof.failure = e instanceof Error ? e.message : String(e)
  } finally {
    proof.requests = requests
    proof.mobileDiagnostics = await mobile
      .evaluate(() => ({
        stages: JSON.parse(sessionStorage.getItem('qwerty.learning-sync-diagnostics.v1') || '[]'),
        startup: sessionStorage.getItem('qwerty.s2.startup-check.v1'),
      }))
      .catch(() => null)
    await Promise.allSettled([desktop.close(), phone.close()])
    if (owner)
      try {
        const auth = await request.post(base + '/api/auth/login', {
          data: { username, password, deviceId: 'qwerty-web-' + crypto.randomUUID() },
        })
        expect(auth.status()).toBe(200)
        const a = await auth.json()
        expect(a.user.userId).toBe(owner)
        const removed = await request.delete(base + '/api/auth/account', {
          data: { currentPassword: password },
          headers: { Authorization: 'Bearer ' + a.token },
        })
        proof.cleanupStatus = removed.status()
        expect(removed.status()).toBe(200)
        expect((await removed.json()).deleted?.accountDeleted).toBe(true)
        proof.cleanupVerified = true
      } catch (e) {
        failures.push(e)
        proof.cleanupVerified = false
      }
    await writeFile(info.outputPath('mobile-cloud-redacted-proof.json'), JSON.stringify(proof, null, 2))
    console.log('MOBILE_CLOUD_REDACTED', JSON.stringify(proof))
  }
  if (failures.length) throw new AggregateError(failures, 'Mobile cloud acceptance failed')
})
