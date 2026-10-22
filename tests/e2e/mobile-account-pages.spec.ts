import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
test('Pages exposes phone account preview but keeps all cloud authentication disabled', async ({ page }) => {
  let requests = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests++
  })
  await page.goto('/qwerty-learner/mobile')
  await page.getByRole('link', { name: '登录或注册', exact: true }).tap()
  await expect(page).toHaveURL(/\/qwerty-learner\/mobile\/account$/)
  await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('当前为开发预览')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: '注册', exact: true }).tap()
  await expect(page.getByRole('button', { name: '注册并登录' })).toBeDisabled()
  await expect(page.getByLabel('用户名', { exact: true })).toBeDisabled()
  expect(requests).toBe(0)
  await page.getByRole('button', { name: '返回', exact: true }).tap()
  await expect(page).toHaveURL(/\/qwerty-learner\/mobile$/)
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
})

for (const withOldAuth of [false, true]) {
  test(
    'Pages legacy records' + (withOldAuth ? ' and credentials' : '') + ' open read-only login preview without migration',
    async ({ page }) => {
      let apiRequests = 0
      page.on('request', (request) => {
        if (request.url().includes('/api/')) apiRequests++
      })
      // Same-origin static document, before ANY app boot or workspace initialization.
      await page.goto('/qwerty-learner/source-commit.txt')
      const before = await page.evaluate(async (withOldAuth) => {
        localStorage.setItem('qwerty.old-mobile-record.v1', 'retain-byte-for-byte')
        if (withOldAuth)
          localStorage.setItem(
            'qwerty.cloudAuth.v1',
            JSON.stringify({
              token: 'legacy-fixture-token',
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              user: { userId: 'legacy-user', username: 'legacy-mobile' },
            }),
          )
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('RecordDB', 1)
          request.onupgradeneeded = () => request.result.createObjectStore('wordRecords', { keyPath: 'id' })
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const word = { id: 1, word: 'retained-legacy-word', dict: 'legacy-fixture', wrongCount: 0, timeStamp: 100 }
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('wordRecords', 'readwrite')
          tx.objectStore('wordRecords').put(word)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        db.close()
        return { word, auth: localStorage.getItem('qwerty.cloudAuth.v1'), marker: localStorage.getItem('qwerty.old-mobile-record.v1') }
      }, withOldAuth)
      await page.goto('/qwerty-learner/mobile/account')
      await expect(page.getByRole('heading', { name: '登录 QWERTY Plus' })).toBeVisible()
      await expect(page.getByRole('note')).toContainText('当前为开发预览')
      await expect(page.getByText('学习数据安全检查未通过', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
      await page.getByRole('tab', { name: '注册', exact: true }).tap()
      await expect(page.getByRole('button', { name: '注册并登录' })).toBeDisabled()
      const after = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open('RecordDB')
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
        const version = db.version
        const words = await new Promise<unknown[]>((resolve, reject) => {
          const r = db.transaction('wordRecords', 'readonly').objectStore('wordRecords').getAll()
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
        db.close()
        return {
          words,
          version,
          auth: localStorage.getItem('qwerty.cloudAuth.v1'),
          marker: localStorage.getItem('qwerty.old-mobile-record.v1'),
          migration: localStorage.getItem('qwerty.s1.workspace-migrated.v1'),
          intent: localStorage.getItem('qwerty.s1.auth-transition.v1'),
        }
      })
      expect(after).toMatchObject({
        words: [before.word],
        version: 1,
        auth: before.auth,
        marker: before.marker,
        migration: null,
        intent: null,
      })
      expect(apiRequests).toBe(0)
    },
  )
}
