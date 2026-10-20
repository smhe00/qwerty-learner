import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('Mobile P0 uses an independent menu, not a scaled desktop toolbar', async ({ page }) => {
  await page.goto('/mobile')
  const menu = page.locator('[data-mobile-menu]')
  await expect(menu).toBeVisible({ timeout: 25_000 })
  await expect(menu.getByRole('heading', { name: /QWERTY/ })).toBeVisible()
  await expect(menu.getByRole('link', { name: '进入沉浸学习页面' })).toBeVisible()
  await expect(menu.getByText('账号与云同步', { exact: true })).toBeVisible()
  await expect(menu.getByText('设置', { exact: true })).toBeVisible()
  await expect(menu.getByText('即将开放', { exact: true })).toHaveCount(5)
  await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
  const bounds = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth, viewport: window.innerWidth,
  }))
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport + 1)
})

test('Mobile P0 read-only study preview opens, reloads and returns with no session mutation', async ({ page }) => {
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 25_000 })
  const before = await page.evaluate(() => localStorage.getItem('reviewModeInfo'))
  await page.getByRole('link', { name: '进入沉浸学习页面' }).click()
  await expect(page).toHaveURL(/\/mobile\/study$/)
  await expect(page.locator('[data-mobile-study]')).toBeVisible()
  await expect(page.getByText('当前词库还没有可恢复的学习会话')).toBeVisible()
  await expect(page.locator('header nav.focus-header-nav')).toHaveCount(0)
  await expect(page.getByText('学习界面预览 · 不会记录拼写结果')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-mobile-study]')).toBeVisible()
  await page.getByRole('link', { name: '返回主菜单' }).click()
  await expect(page).toHaveURL(/\/mobile$/)
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  const after = await page.evaluate(() => localStorage.getItem('reviewModeInfo'))
  expect(after).toBe(before)
})

test('Mobile P0 restores a real persisted checkpoint, keeps the word masked and never writes practice evidence', async ({ page }) => {
  await page.goto('/mobile')
  await expect(page.locator('[data-mobile-menu]')).toBeVisible({ timeout: 25_000 })
  await page.evaluate(async () => {
    const dict = JSON.parse(localStorage.getItem('currentDict') || '"shanghai-zhongkao-2027"')
    const req = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const tx = db.transaction('reviewRecords', 'readwrite')
      tx.objectStore('reviewRecords').add({
        dict, index: 0, createTime: Math.floor(Date.now() / 1000),
        isFinished: false, sessionKind: 'review',
        words: [{
          name: 'apple', trans: ['苹果'], usphone: '', ukphone: '',
          example: [{ en: 'The apple is red.', cn: '苹果是红色的。', start: 4, end: 9 }],
        }],
      })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })
  // Native IndexedDB writes bypass Dexie's liveQuery notifications; refresh
  // to exercise recovery from the persisted database exactly as a new visit.
  await page.reload()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  await expect(page.getByText(/可恢复的学习位置/)).toBeVisible()
  const snapshot = () => page.evaluate(async () => {
    const req = indexedDB.open('RecordDB')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const names = ['wordRecords', 'reviewRecords', 'reviewWordStates']
      return await Promise.all(names.map(name =>
        new Promise<{ name: string; rows: unknown[] }>((resolve, reject) => {
          const req = db.transaction(name, 'readonly').objectStore(name).getAll()
          req.onsuccess = () => resolve({ name, rows: req.result })
          req.onerror = () => reject(req.error)
        })))
    } finally {
      db.close()
    }
  })
  const before = await snapshot()
  await page.getByRole('link', { name: '进入沉浸学习页面' }).click()
  await expect(page.locator('[data-mobile-word-masked]')).toHaveText('＿ ＿ ＿ ＿ ＿')
  await expect(page.locator('[data-mobile-example-masked]')).toContainText('The _____ is red.')
  await expect(page.getByText('苹果是红色的。')).toBeVisible()
  await expect(page.locator('.mobile-study-meaning')).toHaveCount(0)
  await expect(page.locator('[data-mobile-study]')).not.toContainText('apple')
  await page.reload()
  await expect(page.locator('[data-mobile-word-masked]')).toHaveText('＿ ＿ ＿ ＿ ＿')
  await page.getByRole('link', { name: '返回主菜单' }).click()
  await expect(page.locator('[data-mobile-menu]')).toBeVisible()
  expect(await snapshot()).toEqual(before)
})
