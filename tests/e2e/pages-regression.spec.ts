import { expect, test } from '@playwright/test'

const site = 'https://smhe00.github.io/qwerty-learner/'
const targetSha = process.env.PAGES_SOURCE_SHA
if (!targetSha || !/^[a-f0-9]{40}$/.test(targetSha)) throw new Error('Missing verified Pages source SHA')

test('published Pages: matching SHA, cloud disabled, Learn route and reload durability', async ({ page, request }) => {
  test.setTimeout(120_000)
  await expect.poll(async () => {
    const result = await request.get(site + 'source-commit.txt?pages_probe=' + targetSha + '-' + Date.now(), { failOnStatusCode: false })
    return result.ok() ? (await result.text()).trim() : ''
  }, { timeout: 90000, intervals: [1000, 2000, 5000] }).toBe(targetSha)
  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  const original = new URL(page.url())
  for (let step = 0; step < 4; step++) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(original.pathname)
    expect(new URL(page.url()).search).toBe(original.search)
    expect(page.url()).not.toContain('~and~')
  }
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据与备份' }).click()
  // P1 removes the entire cloud account/sync section in Pages builds.
  // Verify local backup remains available and cloud actions are absent.
  await expect(page.getByText('本地备份', { exact: true })).toBeVisible()
  await expect(page.getByText('云端同步与账号', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toHaveCount(0)
})

/**
 * Published-site keyboard smoke. Unlike the deterministic localhost Review
 * fixtures, this uses the actual public dictionary and a fresh browser
 * context. It does not create cloud identities or write synthetic records.
 */
test('published Pages: real Learn keystrokes produce one durable record across refresh', async ({ page, request }) => {
  test.setTimeout(120_000)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt?pages_probe=' + targetSha + '-' + Date.now(), { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(targetSha)

  const pageErrors: string[] = []
  const cloudCalls: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/^\/api\/(auth|sync)(?:\/|$)/.test(path)) cloudCalls.push(path)
  })

  async function progress() {
    return page.evaluate(() => {
      const raw = localStorage.getItem('reviewModeInfo')
      const session = raw ? JSON.parse(raw).reviewRecord : null
      return { index: session?.index ?? null, finished: session?.isFinished === true }
    })
  }
  async function committedRecords(word: string) {
    return page.evaluate((name) => new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('wordRecords', 'readonly')
        const rows = tx.objectStore('wordRecords').getAll()
        rows.onerror = () => reject(rows.error)
        rows.onsuccess = () => {
          resolve(rows.result.filter((record: { word?: string; sourceMode?: string }) =>
            record.word === name && record.sourceMode === 'learn').length)
          db.close()
        }
      }
    }), word)
  }

  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/qwerty-learner\/learn\/?$/)
  await expect(page.getByText('按任意键开始 Learn；Enter 暂停或继续。')).toBeVisible()
  // Learn's landing page is deliberately read-only. No WordComponent exists
  // until a real user start triggers preparation; querying the word before
  // start was an obsolete Typing-style test and failed every Pages build.
  await page.keyboard.press('a') // landing start key is consumed, not typed
  const wordNode = page.locator('[data-typing-word]:visible').first()
  await expect(wordNode).toHaveAttribute('data-typing-word', /\S+/, { timeout: 30_000 })
  await expect(wordNode).toHaveAttribute('data-typing-active', 'true', { timeout: 10_000 })
  const word = await wordNode.getAttribute('data-typing-word')
  expect(word).toBeTruthy()

  await page.keyboard.type(word!)
  await expect.poll(async () => {
    const state = await progress()
    return state.finished || (state.index !== null && state.index > 0)
  }, { timeout: 20_000 }).toBe(true)
  await expect.poll(() => committedRecords(word!), { timeout: 20_000 }).toBe(1)

  const beforeReload = await progress()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: '打开设置对话框' })).toBeVisible()
  await expect.poll(() => progress()).toEqual(beforeReload)
  await expect.poll(() => committedRecords(word!)).toBe(1)
  expect(page.url()).not.toContain('~and~')
  expect(pageErrors).toEqual([])
  expect(cloudCalls).toEqual([])
})

test('published Pages: Typing uses real key input and advances independently', async ({ page, request }) => {
  test.setTimeout(90_000)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt?pages_probe=' + targetSha + '-' + Date.now(), { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 60_000, intervals: [1000, 2000, 5000] }).toBe(targetSha)

  await page.goto(site, { waitUntil: 'domcontentloaded' })
  const typing = page.getByRole('button', { name: 'Typing', exact: true })
  await expect(typing).toBeVisible()
  await typing.click()
  const activeWord = page.locator('[data-typing-word]:visible').first()
  await expect(activeWord).toHaveAttribute('data-typing-word', /\S+/)
  const initial = await activeWord.getAttribute('data-typing-word')
  expect(initial).toBeTruthy()
  await page.keyboard.press('a')
  await page.keyboard.type(initial!)
  await expect.poll(() => activeWord.getAttribute('data-typing-word'), { timeout: 20_000 }).not.toBe(initial)
  await expect(page.getByRole('button', { name: 'Typing', exact: true })).toHaveAttribute('aria-pressed', 'true')
})


/**
 * Ctrl+F5-equivalent: disable browser cache during the navigation/reload.
 * The small donation QR must already be in the app bundle; opening either
 * entry point must not initiate a separate image fetch or show a blank QR.
 */
test('published Pages: donation QR is visible immediately after hard refresh without image request', async ({ page, request, browserName }) => {
  // Chrome DevTools Protocol is Chromium-only; other browsers exercise the shared page flows above.
  test.skip(browserName !== 'chromium', 'CDP network cache control is Chromium-only')
  test.setTimeout(120_000)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt?pages_probe=' + targetSha + '-' + Date.now(), { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(targetSha)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  const qrRequests: string[] = []
  const pageErrors: string[] = []
  page.on('request', req => {
    if (/appreciation[^/]*\.webp(?:\?|$)/i.test(req.url())) qrRequests.push(req.url())
  })
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '打开赞赏页面' }).click()

  const qr = page.getByRole('img', { name: '何世明的微信赞赏码' })
  await expect(qr).toBeVisible({ timeout: 10_000 })
  const src = await qr.getAttribute('src')
  expect(src).toMatch(/^data:image\/webp;base64,/)
  await expect.poll(
    () => qr.evaluate((img: HTMLImageElement) =>
      img.complete && img.naturalWidth > 0 && img.naturalHeight > 0),
    { timeout: 2_000, intervals: [100, 200, 250] },
  ).toBe(true)
  expect(qrRequests, 'the donation QR must not require a delayed network fetch').toEqual([])

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '赞赏 Qwerty Plus' }).click()
  await expect(qr).toBeVisible()
  await expect.poll(
    () => qr.evaluate((img: HTMLImageElement) =>
      img.complete && img.naturalWidth > 0 && img.naturalHeight > 0),
    { timeout: 2_000 },
  ).toBe(true)
  expect(qrRequests).toEqual([])
  expect(pageErrors).toEqual([])
})


test('published Pages: Focus achievements default is accessible on desktop/mobile and keeps Song art hidden', async ({ page, request, browser }) => {
  test.setTimeout(120_000)
  await expect.poll(async () => {
    const response = await request.get(site + 'source-commit.txt?pages_probe=' + targetSha + '-' + Date.now(), { failOnStatusCode: false })
    return response.ok() ? (await response.text()).trim() : ''
  }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(targetSha)

  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(site, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '查看成就' }).click()
  await expect(page.locator('[data-navigation-dialog="achievements"]')).toBeVisible()
  await expect(page.locator('[data-focus-achievement-gallery]').getByRole('heading', { name: '成就' })).toBeVisible()
  await expect(page.locator('.focus-achievements-item')).toHaveCount(34)
  await expect(page.locator('.focus-achievements-item:disabled')).toHaveCount(34)
  await expect(page.locator('.focus-achievements-item:not([data-achievement-id])')).toHaveCount(5)
  await expect(page.getByRole('button', { name: '开启宋韵雅藏' })).toHaveCount(0)
  await expect(page.locator('[data-song-achievement-gallery]')).toHaveCount(0)
  await page.locator('.focus-achievements-item:disabled').first().evaluate(el => el.click())
  await expect(page.locator('.focus-achievements-detail')).toHaveCount(0)
  expect(errors).toEqual([])

  // PR #40 completes the formerly disabled mobile menus. Exercise the real
  // published route and locked cards instead of requiring obsolete P0 copy.
  // Keep the persistent Learn smoke and cloud-disabled guarantees intact.
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobile = await mobileContext.newPage()
  const mobileErrors: string[] = []
  const cloudCalls: string[] = []
  mobile.on('pageerror', error => mobileErrors.push(error.message))
  mobile.on('request', req => {
    if (/\/(?:api)\/(auth|sync)(?:\/|$)/.test(new URL(req.url()).pathname)) cloudCalls.push(req.method())
  })
  try {
    await mobile.goto(site + 'mobile', { waitUntil: 'domcontentloaded' })
    const menu = mobile.locator('[data-mobile-menu]')
    await expect(menu).toBeVisible({ timeout: 20_000 })
    await expect(menu.locator('.mobile-home-menu a')).toHaveCount(5)
    await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: /^学习记录/ })).toHaveAttribute('href', '/qwerty-learner/mobile/history')
    await expect(menu.getByRole('link', { name: /^账号与云同步/ })).toHaveAttribute('href', '/qwerty-learner/mobile/data')
    await menu.getByRole('link', { name: /^成就/ }).click()
    await expect(mobile).toHaveURL(/\/qwerty-learner\/mobile\/achievements\/?$/)
    await expect(mobile.locator('[data-focus-achievement-gallery]').getByRole('heading', { name: '成就' })).toBeVisible()
    await expect(mobile.locator('.focus-achievements-item')).toHaveCount(34)
    await expect(mobile.locator('.focus-achievements-item:disabled')).toHaveCount(34)
    await expect(mobile.locator('.focus-achievements-item:not([data-achievement-id])')).toHaveCount(5)
    await expect(mobile.getByRole('button', { name: '开启宋韵雅藏' })).toHaveCount(0)
    await expect(mobile.locator('[data-song-achievement-gallery]')).toHaveCount(0)
    await mobile.locator('.focus-achievements-item:disabled').first().evaluate(el => el.click())
    await expect(mobile.locator('.focus-achievements-detail')).toHaveCount(0)
    await mobile.getByRole('button', { name: '返回手机首页', exact: true }).click()
    await expect(menu).toBeVisible()
    await expect(mobile.getByRole('link', { name: /(?:开始|继续)手机学习/ })).toBeVisible()
    await mobile.getByRole('link', { name: /(?:开始|继续)手机学习/ }).click()
    await expect(mobile).toHaveURL(/\/mobile\/study\/?$/)
    await expect(mobile.locator('[data-mobile-word-practice]')).toBeVisible({ timeout: 45_000 })
    await expect(mobile.locator('header nav.focus-header-nav')).toHaveCount(0)
    await expect.poll(() => mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
    await mobile.getByRole('button', { name: '返回主菜单' }).click()
    await expect(mobile).toHaveURL(/\/mobile\/?$/)
    await expect(menu).toBeVisible()
    expect(mobileErrors).toEqual([])
    expect(cloudCalls).toEqual([])
  } finally {
    await mobileContext.close()
  }
})
