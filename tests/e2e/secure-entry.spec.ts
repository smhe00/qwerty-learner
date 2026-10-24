import { expect, test } from '@playwright/test'

// Serve local source under the exact insecure origin; NO production network.
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('http://q.smhe.cn/**', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/preservation-fixture.html') return route.fulfill({ contentType: 'text/html', body: '<title>Storage fixture</title>' })
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 500, body: 'unexpected HTTP API request' })
    const response = await route.fetch({ url: baseURL + u.pathname + u.search })
    await route.fulfill({ response })
  })
  await context.route('https://q.smhe.cn/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Secure destination fixture</h1>' }),
  )
})

test('HTTP entry preserves local records, blocks boot/login, and opens a clean HTTPS URL', async ({ page, context }) => {
  await page.goto('http://q.smhe.cn/preservation-fixture.html')
  await page.evaluate(async () => {
    localStorage.setItem('preservation-fixture', 'keep')
    localStorage.setItem('qwerty.cloudAuth.v1', JSON.stringify({ token: 'synthetic-do-not-transfer' }))
    await new Promise<void>((ok, fail) => {
      const q = indexedDB.open('HTTP-preservation-fixture', 1)
      q.onupgradeneeded = () => q.result.createObjectStore('rows')
      q.onsuccess = () => {
        const db = q.result
        const tx = db.transaction('rows', 'readwrite')
        tx.objectStore('rows').put({ word: '中文🙂', count: 1 }, 'original')
        tx.oncomplete = () => {
          db.close()
          ok()
        }
        tx.onerror = () => fail(tx.error)
      }
      q.onerror = () => fail(q.error)
    })
  })
  let api = 0
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) api++
  })
  await page.goto('http://q.smhe.cn/mobile/account?s1-reauth=1#synthetic-private')
  await expect(page.getByRole('dialog')).toContainText('使用安全连接')
  await expect(page.locator('[data-account],[data-mobile-menu]')).toHaveCount(0)
  const popupPromise = context.waitForEvent('page')
  await page.getByRole('link', { name: '打开安全站点' }).tap()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toBe('https://q.smhe.cn/mobile/account')
  expect(await popup.evaluate(() => window.opener)).toBe(null)
  expect(await popup.evaluate(() => localStorage.getItem('qwerty.cloudAuth.v1'))).toBe(null)
  const kept = await page.evaluate(async () => {
    const row = await new Promise((ok, fail) => {
      const q = indexedDB.open('HTTP-preservation-fixture')
      q.onsuccess = () => {
        const db = q.result
        const tx = db.transaction('rows')
        const r = tx.objectStore('rows').get('original')
        r.onsuccess = () => ok(r.result)
        tx.oncomplete = () => db.close()
      }
      q.onerror = () => fail(q.error)
    })
    return {
      row,
      storage: localStorage.getItem('preservation-fixture'),
      auth: localStorage.getItem('qwerty.cloudAuth.v1'),
      dbs: (await indexedDB.databases()).map((x) => x.name),
    }
  })
  expect(kept.row).toEqual({ word: '中文🙂', count: 1 })
  expect(kept.storage).toBe('keep')
  expect(kept.auth).toContain('synthetic-do-not-transfer')
  expect(kept.dbs).toEqual(['HTTP-preservation-fixture'])
  expect(api).toBe(0)
})

test('explicit HTTP local-only viewing never exposes the login form or enables cloud', async ({ page }) => {
  let api = 0
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) api++
  })
  await page.goto('http://q.smhe.cn/mobile')
  await page.getByRole('button', { name: '继续本机学习（不同步）' }).tap()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 40_000 })
  await expect(page.locator('.mobile-home-footer')).toContainText('当前仅在本机保存')
  await page.getByRole('link', { name: '登录或注册', exact: true }).tap()
  await page.getByRole('button', { name: '登录或注册', exact: true }).tap()
  await expect(page.locator('[data-secure-entry]')).toBeVisible()
  await expect(page.getByLabel('账户密码', { exact: true })).toHaveCount(0)
  expect(api).toBe(0)
})
